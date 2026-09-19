import { ChatService } from '../../src/modules/chat/chat.service';
import { REASONING_LIMITS } from '../../src/modules/chat/reasoning-stream';

const CAPABILITY = {
  mode: 'automatic',
  discovered: {
    supported: true,
    output: 'summary',
    streaming: true,
    sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
    discoveredAt: '2026-09-19T00:00:00.000Z',
  },
  manual: { supported: null, output: null, streaming: null },
};
const UNSUPPORTED = {
  ...CAPABILITY,
  discovered: { ...CAPABILITY.discovered, supported: false, output: 'none', streaming: false },
};

const model = (reasoningConfig: unknown) => ({
  id: 'model-1',
  actualName: 'gpt-4o-mini',
  providerId: 'openai',
  enabled: true,
  visibility: 'public',
  fallbackModelId: null,
  inputPricePer1k: 0.5,
  outputPricePer1k: 1.5,
  reasoningConfig,
});

const reasoningChunk = (reasoning: string) => ({ choices: [{ delta: { reasoning } }] });
const textChunk = (content: string, usage?: Record<string, number>) => ({
  choices: [{ delta: { content } }],
  usage,
});

function build(options: { model?: unknown; chunks?: unknown[][] } = {}) {
  const conversations = {
    create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    findById: jest.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
    appendUserMessage: jest.fn(),
    appendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    updateMessageStatus: jest.fn().mockResolvedValue(undefined),
    findStreamingMessage: jest.fn().mockResolvedValue(null),
    completeIfStreaming: jest.fn().mockResolvedValue(true),
  };
  // One provider call per turn when web search is off, so reasoning deltas and
  // the answer arrive in the same stream — exactly how a provider streams them.
  const chunks = options.chunks ?? [
    [
      reasoningChunk('weighing options '),
      reasoningChunk('carefully'),
      textChunk('The answer.', { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }),
    ],
  ];
  const runtime = {
    assertReady: jest.fn().mockResolvedValue({}),
    stream: jest.fn(),
  };
  for (const batch of chunks) {
    runtime.stream.mockImplementationOnce(async function* () {
      for (const chunk of batch) yield chunk;
    });
  }
  const usage = {
    create: jest.fn().mockResolvedValue({ id: 'usage-1' }),
    finalize: jest.fn().mockResolvedValue(undefined),
  };
  const selected = options.model ?? model(CAPABILITY);

  const service = new ChatService(
    {
      findById: jest.fn().mockResolvedValue(selected),
      resolveActiveModel: jest.fn().mockResolvedValue(selected),
    } as never,
    { canAccessUser: jest.fn().mockResolvedValue(true) } as never,
    runtime as never,
    conversations as never,
    { update: jest.fn().mockResolvedValue(undefined) } as never,
    usage as never,
    {
      checkAndReserve: jest.fn().mockResolvedValue({ reserved: true, quotaId: 'q1', tokenRemaining: 9 }),
      finalize: jest.fn().mockResolvedValue(undefined),
      refund: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      establish: jest.fn().mockResolvedValue({
        model: selected,
        connection: {},
        stream: (async function* () {})(),
        attempts: 1,
        failures: [],
      }),
    } as never,
    { isConfigured: () => true, search: jest.fn() } as never,
  );

  return { service, runtime, conversations, usage, selected };
}

function collect(service: ChatService, dto: unknown): Promise<Array<Record<string, any>>> {
  return new Promise((resolve, reject) => {
    const events: Array<Record<string, any>> = [];
    service.streamChat('user-1', dto as never).subscribe({
      next: (event) => events.push(event as never),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

const phases = (events: Array<Record<string, any>>) =>
  events.filter((e) => e.type === 'status').map((e) => e.data.phase);

describe('ChatService reasoning', () => {
  it('emits the reasoning lifecycle, then the answer, and persists the summary', async () => {
    const { service, runtime, conversations } = build();

    const events = await collect(service, { message: 'think', modelId: 'model-1', reasoning: true });

    expect(runtime.stream.mock.calls[0][1].reasoning).toEqual({ enabled: true, summary: true });
    expect(phases(events)).toEqual(['reasoning_started', 'reasoning_completed', 'answer_started']);
    expect(events.filter((e) => e.type === 'reasoning_delta').map((e) => e.data.delta)).toEqual([
      'weighing options ',
      'carefully',
    ]);
    expect(events.filter((e) => !e.type && e.data.delta)).toEqual([{ data: { delta: 'The answer.' } }]);
    expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'The answer.', [], {
      enabled: true,
      summary: 'weighing options carefully',
    });
    expect(events).toContainEqual({ type: 'done', data: {} });
    // A reasoning turn that completes must never also report an error.
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('keeps the normal path untouched when reasoning is off', async () => {
    const { service, runtime, conversations } = build({
      chunks: [
        [textChunk('plain', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })],
      ],
    });

    const events = await collect(service, { message: 'hi', modelId: 'model-1' });

    expect(runtime.stream.mock.calls[0][1].reasoning).toBeUndefined();
    expect(events.some((e) => e.type === 'reasoning_delta')).toBe(false);
    expect(events.some((e) => e.type === 'status')).toBe(false);
    expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'plain', [], {
      enabled: false,
      summary: null,
    });
  });

  it('rejects explicit reasoning for an unsupported model instead of disabling it', async () => {
    const { service, runtime, conversations } = build({ model: model(UNSUPPORTED) });

    const events = await collect(service, { message: 'think', modelId: 'model-1', reasoning: true });

    expect(runtime.stream).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'error',
      data: {
        code: 'reasoning_unsupported',
        message: expect.stringContaining('reasoning'),
      },
    });
    expect(conversations.updateMessageStatus).not.toHaveBeenCalled();
  });

  it('rejects explicit reasoning when capability was never determined', async () => {
    const { service } = build({ model: model({}) });
    const events = await collect(service, { message: 'think', modelId: 'model-1', reasoning: true });
    expect(events.some((e) => e.type === 'error' && e.data.code === 'reasoning_unsupported')).toBe(
      true,
    );
  });

  it('enables reasoning without summary output for a model that exposes none', async () => {
    const noSummary = model({
      mode: 'manual',
      manual: { supported: true, output: 'none', streaming: false },
      discovered: CAPABILITY.discovered,
    });
    const { service, runtime, conversations } = build({
      model: noSummary,
      chunks: [[textChunk('internal reasoning only', {})]],
    });
    // No reasoning chunk is streamed for a model that exposes no summary.

    const events = await collect(service, { message: 'think', modelId: 'model-1', reasoning: true });

    expect(runtime.stream.mock.calls[0][1].reasoning).toEqual({ enabled: true, summary: false });
    expect(events.some((e) => e.type === 'reasoning_delta')).toBe(false);
    expect(events.some((e) => e.type === 'status' && e.data.phase === 'answer_started')).toBe(true);
    expect(conversations.completeIfStreaming).toHaveBeenCalledWith(
      'msg-1',
      'internal reasoning only',
      [],
      { enabled: true, summary: null },
    );
  });

  it('does not persist a summary for a provider error mid-stream', async () => {
    const { service, runtime, conversations } = build();
    runtime.stream.mockReset();
    runtime.stream.mockImplementation(async function* () {
      yield reasoningChunk('half a thought');
      throw new Error('upstream exploded');
    });

    const events = await collect(service, { message: 'think', modelId: 'model-1', reasoning: true });

    expect(conversations.completeIfStreaming).not.toHaveBeenCalled();
    expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'failed', expect.any(String));
    expect(events.some((e) => e.type === 'error')).toBe(true);
  });

  it('caps the streamed reasoning summary', async () => {
    const { service } = build({
      chunks: [
        [reasoningChunk('x'.repeat(REASONING_LIMITS.MAX_SUMMARY_CHARS + 10)), textChunk('done', {})],
      ],
    });

    const events = await collect(service, { message: 'think', modelId: 'model-1', reasoning: true });

    const streamed = events
      .filter((e) => e.type === 'reasoning_delta')
      .map((e) => e.data.delta)
      .join('');
    expect(streamed).toHaveLength(REASONING_LIMITS.MAX_SUMMARY_CHARS);
  });
});
