import { ChatService } from '../../src/modules/chat/chat.service';
import { AllProvidersUnavailableError } from '../../src/modules/provider/provider-failover.service';
import { NormalizedProviderError } from '../../src/modules/provider/errors/normalized-provider.error';

const MODEL = {
  id: 'model-1',
  actualName: 'gpt-4o-mini',
  providerId: 'openai',
  enabled: true,
  visibility: 'public',
  fallbackModelId: 'model-2',
  inputPricePer1k: 0.5,
  outputPricePer1k: 1.5,
};

const FALLBACK_MODEL = {
  ...MODEL,
  id: 'model-2',
  actualName: 'llama-3',
  providerId: 'groq',
  inputPricePer1k: 0.1,
  outputPricePer1k: 0.2,
};

function chunk(content: string, usage?: Record<string, number>) {
  return { choices: [{ delta: { content } }], usage };
}

function emptyStream() {
  return (async function* () {
    /* no chunks */
  })();
}

function build() {
  const conversations = {
    create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    findById: jest.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
    appendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    updateMessageStatus: jest.fn().mockResolvedValue(undefined),
    findStreamingMessage: jest.fn().mockResolvedValue(null),
  };
  const usage = {
    create: jest.fn().mockResolvedValue({ id: 'usage-1' }),
    finalize: jest.fn().mockResolvedValue(undefined),
  };
  const quotas = {
    checkAndReserve: jest
      .fn()
      .mockResolvedValue({ reserved: true, quotaId: 'q1', tokenRemaining: 1000 }),
    finalize: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const failover = { establish: jest.fn() };
  const models = {
    findById: jest.fn().mockResolvedValue(MODEL),
    resolveActiveModel: jest.fn().mockResolvedValue(MODEL),
  };
  const access = { canAccessUser: jest.fn().mockResolvedValue(true) };
  const userRepo = { update: jest.fn().mockResolvedValue(undefined) };

  const service = new ChatService(
    models as never,
    access as never,
    { assertReady: jest.fn(), stream: jest.fn() } as never,
    conversations as never,
    userRepo as never,
    usage as never,
    quotas as never,
    failover as never,
  );

  return { service, conversations, usage, quotas, failover, models, access };
}

/** Drain an Observable of chat events into an array. */
function collect(service: ChatService, userId: string, dto: unknown): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    service.streamChat(userId, dto as never).subscribe({
      next: (e) => events.push(e),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

describe('ChatService fallback (spec 006)', () => {
  it('streams normally through the primary on first-attempt success', async () => {
    const { service, failover, usage } = build();
    failover.establish.mockResolvedValue({
      model: MODEL,
      connection: {},
      stream: (async function* () {
        yield chunk('hello ');
        yield chunk('world', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
      })(),
      attempts: 1,
      failures: [],
    });

    const events = await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events).toContainEqual({ data: { delta: 'hello ' } });
    expect(events).toContainEqual({ event: 'done', data: {} });
    expect(usage.create).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'model-1', providerId: 'openai', attempts: 1 }),
    );
    expect(usage.finalize).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ totalTokens: 15, status: 'completed' }),
    );
  });

  it('records the effective model and attempt count when a fallback served the request', async () => {
    const { service, failover, usage } = build();
    failover.establish.mockResolvedValue({
      model: FALLBACK_MODEL,
      connection: {},
      stream: (async function* () {
        yield chunk('from backup', { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 });
      })(),
      attempts: 3,
      failures: [],
    });

    await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(usage.create).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'model-2', providerId: 'groq', attempts: 3 }),
    );
    // Cost is computed with the fallback's pricing, not the primary's.
    expect(usage.finalize).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ inputPricePer1k: 0.1, outputPricePer1k: 0.2, status: 'completed' }),
    );
  });

  it('creates exactly one assistant message even when three attempts were made', async () => {
    const { service, failover, conversations } = build();
    failover.establish.mockResolvedValue({
      model: FALLBACK_MODEL,
      connection: {},
      stream: (async function* () {
        yield chunk('ok');
      })(),
      attempts: 3,
      failures: [],
    });

    await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(conversations.appendMessage).toHaveBeenCalledTimes(1);
    expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'completed', 'ok');
  });

  it('emits a retrying status event before each re-attempt', async () => {
    const { service, failover } = build();
    failover.establish.mockImplementation(async (input: { onRetry?: (i: unknown) => void }) => {
      input.onRetry?.({ attempt: 2, maxAttempts: 2 });
      return {
        model: MODEL,
        connection: {},
        stream: (async function* () {
          yield chunk('ok');
        })(),
        attempts: 2,
        failures: [],
      };
    });

    const events = await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events).toContainEqual({
      event: 'status',
      data: { phase: 'retrying', attempt: 2, maxAttempts: 2 },
    });
  });

  it('reports all_providers_unavailable, fails the message once, and refunds the quota', async () => {
    const { service, failover, conversations, quotas, usage } = build();
    failover.establish.mockRejectedValue(
      new AllProvidersUnavailableError(
        [
          {
            modelId: 'model-1',
            providerId: 'openai',
            attempt: 1,
            code: 'credentials_rejected',
            category: 'terminal',
            durationMs: 3,
          },
          {
            modelId: 'model-2',
            providerId: 'groq',
            attempt: 1,
            code: 'provider_unreachable',
            category: 'transient',
            durationMs: 3,
          },
        ],
        2,
      ),
    );

    const events = await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events).toContainEqual({
      event: 'error',
      data: expect.objectContaining({ code: 'all_providers_unavailable' }),
    });
    expect(conversations.appendMessage).toHaveBeenCalledTimes(1);
    expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'failed', '');
    expect(quotas.refund).toHaveBeenCalledWith('q1', expect.any(Number));
    // A failed attempt is still accounted for, against the requested model.
    expect(usage.create).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'model-1', attempts: 2 }),
    );
    expect(usage.finalize).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ status: 'failed', totalTokens: 0 }),
    );
  });

  it('does not leak provider internals in the failure message', async () => {
    const { service, failover } = build();
    failover.establish.mockRejectedValue(
      new AllProvidersUnavailableError(
        [
          {
            modelId: 'model-1',
            providerId: 'openai',
            attempt: 1,
            code: 'credentials_rejected',
            category: 'terminal',
            durationMs: 1,
          },
        ],
        1,
      ),
    );

    const events = (await collect(service, 'user-1', {
      message: 'hi',
      modelId: 'model-1',
    })) as Array<{ event?: string; data?: { message?: string } }>;
    const errorEvent = events.find((e) => e.event === 'error');

    expect(errorEvent?.data?.message).not.toMatch(/openai|groq|sk-|baseUrl|apiKey/i);
  });

  it('does not retry a mid-stream failure, and marks the message failed once', async () => {
    const { service, failover, conversations } = build();
    failover.establish.mockResolvedValue({
      model: MODEL,
      connection: {},
      stream: (async function* () {
        yield chunk('partial');
        throw new NormalizedProviderError({
          code: 'provider_unreachable',
          message: 'Provider could not be reached.',
          statusCode: 502,
          originalMessage: 'socket hang up',
        });
      })(),
      attempts: 1,
      failures: [],
    });

    const events = await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    // Establishment happened exactly once — a mid-stream failure is terminal.
    expect(failover.establish).toHaveBeenCalledTimes(1);
    expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'failed', 'partial');
    expect(events).toContainEqual({
      event: 'error',
      data: expect.objectContaining({ code: 'provider_error' }),
    });
    expect(events).not.toContainEqual({ event: 'done', data: {} });
  });

  it('passes the caller entitlement predicate into candidate resolution', async () => {
    const { service, failover, access } = build();
    failover.establish.mockImplementation(
      async (input: { isAllowed: (m: unknown) => Promise<boolean> }) => {
        await input.isAllowed(FALLBACK_MODEL);
        return {
          model: MODEL,
          connection: {},
          stream: emptyStream(),
          attempts: 1,
          failures: [],
        };
      },
    );

    await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(access.canAccessUser).toHaveBeenCalledWith('user-1', FALLBACK_MODEL);
  });

  it('keeps the assistant message alive when the primary fails over successfully', async () => {
    const { service, failover, conversations } = build();
    failover.establish.mockResolvedValue({
      model: FALLBACK_MODEL,
      connection: {},
      stream: (async function* () {
        yield chunk('done via backup');
      })(),
      attempts: 2,
      failures: [],
    });

    await collect(service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(conversations.updateMessageStatus).toHaveBeenCalledTimes(2);
    expect(conversations.updateMessageStatus).toHaveBeenNthCalledWith(1, 'msg-1', 'streaming');
    expect(conversations.updateMessageStatus).toHaveBeenNthCalledWith(
      2,
      'msg-1',
      'completed',
      'done via backup',
    );
  });
});
