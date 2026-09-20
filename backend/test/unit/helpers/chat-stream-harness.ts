import { ChatService } from '../../../src/modules/chat/chat.service';

export const MODEL = {
  id: 'model-1',
  actualName: 'gpt-4o-mini',
  providerId: 'openai',
  enabled: true,
  visibility: 'public',
  inputPricePer1m: 500_000,
  outputPricePer1m: 1_000_000,
};

/** Provider chunk shape used across the chat billing specs. */
export function contentChunk(content: string, usage?: Record<string, unknown>) {
  return { choices: [{ delta: { content } }], usage };
}

/**
 * Mock harness matching the ChatService constructor's 11 positional
 * dependencies. Every mock is returned so individual tests can override it.
 */
export function buildChatHarness() {
  const conversations = {
    create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    findById: jest.fn().mockResolvedValue({ id: 'conv-1', userId: 'user-1', messages: [] }),
    appendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    appendUserMessage: jest.fn().mockResolvedValue({ id: 'um-1' }),
    updateMessageStatus: jest.fn().mockResolvedValue(undefined),
    findStreamingMessage: jest.fn().mockResolvedValue(null),
    completeIfStreaming: jest.fn().mockResolvedValue(true),
  };
  const usage = {
    create: jest.fn().mockResolvedValue({ id: 'usage-1' }),
    finalizeOnce: jest.fn().mockResolvedValue(true),
  };
  const pricing = {
    calculateLlmCost: jest.fn().mockResolvedValue({ chargedCost: 200, chargedCredits: 2 }),
    getOutputCreditRate: jest.fn().mockResolvedValue(0), // 0 disables the §3.8 budget guard
    calculateWebSearchCost: jest.fn().mockReturnValue(0), // 0 disables search billing
  };
  const wallet = {
    getBalance: jest.fn().mockResolvedValue(50),
    deductCreditsWithGrace: jest.fn().mockResolvedValue({ userId: 'user-1', creditBalance: 48 }),
    deductCredits: jest.fn().mockResolvedValue({ userId: 'user-1', creditBalance: 48 }),
    grantCredits: jest.fn().mockResolvedValue(undefined),
  };
  const runtime = {
    assertReady: jest.fn().mockResolvedValue({ provider: { id: 'openai' }, adapter: {} }),
    stream: jest.fn(),
  };
  const failover = {
    establish: jest.fn().mockResolvedValue({
      model: MODEL,
      connection: {},
      stream: (async function* () {
        /* empty */
      })(),
      attempts: 1,
      failures: [],
    }),
  };
  const models = {
    findById: jest.fn().mockResolvedValue(MODEL),
    resolveActiveModel: jest.fn().mockResolvedValue(MODEL),
  };
  const access = { canAccessUser: jest.fn().mockResolvedValue(true) };
  const userRepo = { update: jest.fn().mockResolvedValue(undefined) };
  const webSearch = {
    isConfigured: () => true,
    search: jest.fn().mockResolvedValue({ query: '', sources: [], empty: true }),
  };

  const service = new ChatService(
    models as never,
    access as never,
    runtime as never,
    conversations as never,
    {} as never, // files (not exercised by these specs)
    userRepo as never,
    usage as never,
    pricing as never,
    failover as never,
    webSearch as never,
    wallet as never, // 11th arg — appended by Task 4
  );

  return {
    service,
    conversations,
    usage,
    pricing,
    wallet,
    runtime,
    failover,
    models,
    access,
    userRepo,
    webSearch,
  };
}

/** Drain an Observable of chat events into an array. */
export function collect(service: ChatService, userId: string, dto: unknown): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    service.streamChat(userId, dto as never).subscribe({
      next: (e) => events.push(e),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

/** Poll until `fn()` is true, for tests that must await detached async work. */
export async function until(fn: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('condition not met within timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
}
