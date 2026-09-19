import { ChatService, ChatStatusEvent, ChatStreamEvent } from '../../src/modules/chat/chat.service';
import { WEB_SEARCH_LIMITS } from '../../src/modules/web-search/web-search.constants';

const MODEL = {
  id: 'model-1',
  actualName: 'gpt-4o-mini',
  providerId: 'openai',
  enabled: true,
  visibility: 'public',
  fallbackModelId: null,
  inputPricePer1m: 500_000,
  outputPricePer1m: 1_000_000,
};

const outcome = {
  query: 'cats',
  creditsUsed: 2,
  empty: false,
  sources: [
    { id: 'S1', title: 'Cats', url: 'https://cats.test', snippet: 'meow', provider: 'fake', content: 'body' },
  ],
};

function toolCallChunk() {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'web_search', arguments: '{"query":"cats"}' },
            },
          ],
        },
      },
    ],
  };
}

function textChunk(content: string, usage?: Record<string, number>) {
  return { choices: [{ delta: { content } }], usage };
}

function build() {
  const conversations = {
    create: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    findById: jest.fn().mockResolvedValue({ id: 'conv-1', messages: [] }),
    appendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    updateMessageStatus: jest.fn().mockResolvedValue(undefined),
    findStreamingMessage: jest.fn().mockResolvedValue(null),
    completeIfStreaming: jest.fn().mockResolvedValue(true),
  };
  const runtime = {
    assertReady: jest.fn().mockResolvedValue({}),
    stream: jest
      .fn()
      .mockImplementationOnce(async function* () {
        yield toolCallChunk();
      })
      .mockImplementationOnce(async function* () {
        yield textChunk('Cats are great [S1].', { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 });
      }),
  };
  const webSearch = {
    isConfigured: () => true,
    search: jest.fn().mockResolvedValue(outcome),
  };
  const usage = {
    create: jest.fn().mockResolvedValue({ id: 'usage-1' }),
    finalize: jest.fn().mockResolvedValue(undefined),
  };
  const service = new ChatService(
    { findById: jest.fn().mockResolvedValue(MODEL), resolveActiveModel: jest.fn().mockResolvedValue(MODEL) } as never,
    { canAccessUser: jest.fn().mockResolvedValue(true) } as never,
    runtime as never,
    conversations as never,
    {} as never, // files (not exercised by these cases)
    { update: jest.fn() } as never,
    usage as never,
    {
      calculateLlmCost: jest.fn().mockResolvedValue({ chargedCost: 0, chargedCredits: 0 }),
    } as never,
    {
      establish: jest.fn().mockResolvedValue({
        model: MODEL,
        connection: {},
        stream: (async function* () {})() as AsyncIterable<never>,
        attempts: 1,
        failures: [],
      }),
    } as never,
    webSearch as never,
  );
  return { service, runtime, conversations, usage, webSearch };
}

function collect(service: ChatService, dto: unknown): Promise<ChatStreamEvent[]> {
  return new Promise((resolve, reject) => {
    const events: ChatStreamEvent[] = [];
    service.streamChat('user-1', dto as never).subscribe({
      next: (e) => events.push(e),
      error: reject,
      complete: () => resolve(events),
    });
  });
}

function isStatus(e: ChatStreamEvent): e is ChatStatusEvent {
  return 'type' in e && e.type === 'status';
}

function statusOf(events: ChatStreamEvent[], phase: string): ChatStatusEvent | undefined {
  return events.find((e): e is ChatStatusEvent => isStatus(e) && e.data.phase === phase);
}

describe('ChatService web search', () => {
  it('runs a bounded tool loop, feeds results back, and emits citations', async () => {
    const { service, runtime, conversations, usage, webSearch } = build();

    const events = await collect(service, { message: 'tell me about cats', modelId: 'model-1', webSearch: true });

    expect(runtime.stream.mock.calls[0][1].tools).toHaveLength(1);
    expect(runtime.stream.mock.calls[0][1].tools[0].function.name).toBe('web_search');

    const phases = events
      .filter(isStatus)
      .map((e) => e.data.phase)
      .filter((p) => p !== 'retrying');
    expect(phases).toEqual(['search_started', 'search_completed', 'retrieval_started', 'retrieval_completed', 'generating']);
    expect(statusOf(events, 'search_completed')?.data).toMatchObject({ sources: 1, credits: 2 });

    const secondMessages = runtime.stream.mock.calls[1][1].messages;
    expect(secondMessages.at(-1)).toMatchObject({ role: 'tool', toolCallId: 'call_1' });
    expect(secondMessages.at(-1).content).toContain('UNTRUSTED');

    expect(conversations.completeIfStreaming).toHaveBeenCalledWith(
      'msg-1',
      'Cats are great [S1].',
      [{ id: 'S1', title: 'Cats', url: 'https://cats.test', snippet: 'meow' }],
      { enabled: false, summary: null },
    );
    expect(events).toContainEqual({
      type: 'citations',
      data: { sources: [{ id: 'S1', title: 'Cats', url: 'https://cats.test', snippet: 'meow' }] },
    });
    expect(events).toContainEqual({ type: 'done', data: {} });
    expect(usage.finalize).toHaveBeenCalledWith('usage-1', expect.objectContaining({ searchCredits: 2, status: 'completed' }));
    expect(webSearch.search).toHaveBeenCalledTimes(1);
  });

  it('offers no tools and never searches when the flag is absent', async () => {
    const { service, runtime, webSearch } = build();
    runtime.stream.mockReset();
    runtime.stream.mockImplementation(async function* () {
      yield textChunk('hi', {});
    });

    const events = await collect(service, { message: 'hi', modelId: 'model-1' });

    expect(runtime.stream.mock.calls[0][1].tools).toBeUndefined();
    expect(webSearch.search).not.toHaveBeenCalled();
    expect(events.some((e) => 'type' in e && e.type === 'citations')).toBe(false);
    expect(events).toContainEqual({ type: 'done', data: {} });
  });

  it('survives a search failure and keeps the stream alive', async () => {
    const { service, runtime, webSearch } = build();
    webSearch.search.mockRejectedValue(new Error('boom'));

    const events = await collect(service, { message: 'cats', modelId: 'model-1', webSearch: true });

    const secondMessages = runtime.stream.mock.calls[1][1].messages;
    expect(secondMessages.at(-1).content).toContain('web_search_provider_error');
    expect(events).toContainEqual({ type: 'done', data: {} });
  });

  it('caps searches per turn', async () => {
    const { service, runtime, webSearch } = build();
    runtime.stream.mockReset();
    for (let i = 0; i < WEB_SEARCH_LIMITS.MAX_SEARCHES_PER_TURN + 1; i++) {
      runtime.stream.mockImplementationOnce(async function* () {
        yield toolCallChunk();
      });
    }
    runtime.stream.mockImplementation(async function* () {
      yield textChunk('done', {});
    });

    await collect(service, { message: 'cats', modelId: 'model-1', webSearch: true });

    expect(webSearch.search).toHaveBeenCalledTimes(WEB_SEARCH_LIMITS.MAX_SEARCHES_PER_TURN);
  });
});
