// `@nestjs/bullmq` is an ESM module that Jest cannot import under the default
// ts-jest transform. It is pulled in transitively via `files.service.ts` →
// `chat.service.ts`. Mock it at the entry point so these tests can load.
jest.mock('@nestjs/bullmq', () => ({
  InjectQueue: () => jest.fn(),
}));
jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn().mockResolvedValue({}),
    close: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { buildChatHarness, collect, contentChunk } from './helpers/chat-stream-harness';
import { WEB_SEARCH_LIMITS } from '../../src/modules/web-search/web-search.constants';
import type { ChatStreamEvent, ChatStatusEvent } from '../../src/modules/chat/chat.service';

/** The LLM charge is zeroed so the search charge is the only wallet mutation. */
const NO_LLM_CHARGE = { chargedCost: 0, chargedCredits: 0 };

function toolCallChunk(query: string) {
  return {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'call_1',
              type: 'function' as const,
              function: { name: 'web_search', arguments: JSON.stringify({ query }) },
            },
          ],
        },
      },
    ],
  };
}

function searchCompleted(events: ChatStreamEvent[]): ChatStatusEvent | undefined {
  return events.find(
    (e): e is ChatStatusEvent =>
      'type' in e && e.type === 'status' && e.data.phase === 'search_completed',
  );
}

describe('ChatService web search billing (Phase 4 §4.1/§4.2)', () => {
  it('deducts the fixed search price for a successful search', async () => {
    const h = buildChatHarness();
    h.pricing.calculateLlmCost = jest.fn().mockResolvedValue(NO_LLM_CHARGE);
    h.pricing.calculateWebSearchCost = jest.fn().mockReturnValue(10);
    h.runtime.stream
      .mockImplementationOnce(async function* () {
        yield toolCallChunk('cats');
      })
      .mockImplementation(async function* () {
        yield contentChunk('Cats are great [S1].', {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        });
      });
    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'u1', role: 'user', content: 'hi' }],
    });

    await collect(h.service, 'user-1', { message: 'cats', modelId: 'model-1', webSearch: true });

    expect(h.pricing.calculateWebSearchCost).toHaveBeenCalled();
    expect(h.wallet.deductCredits).toHaveBeenCalledWith('user-1', 10);
    // A search is a discrete charge: no mid-stream grace is applied.
    expect(h.wallet.deductCreditsWithGrace).not.toHaveBeenCalled();
  });

  it('accumulates search credits across multiple successful searches in one turn', async () => {
    const h = buildChatHarness();
    h.pricing.calculateLlmCost = jest.fn().mockResolvedValue(NO_LLM_CHARGE);
    h.pricing.calculateWebSearchCost = jest.fn().mockReturnValue(10);
    h.runtime.stream
      .mockImplementationOnce(async function* () {
        yield toolCallChunk('cats');
      })
      .mockImplementationOnce(async function* () {
        yield toolCallChunk('dogs');
      })
      .mockImplementation(async function* () {
        yield contentChunk('Cats and dogs are great [S1][S2].', {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        });
      });

    h.webSearch.search
      .mockResolvedValueOnce({
        query: 'cats',
        sources: [
          { id: 'S1', title: 'Cats', url: 'https://cats.test', snippet: 'meow', provider: 'fake' },
        ],
        empty: false,
      })
      .mockResolvedValueOnce({
        query: 'dogs',
        sources: [
          { id: 'S2', title: 'Dogs', url: 'https://dogs.test', snippet: 'woof', provider: 'fake' },
        ],
        empty: false,
      });

    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'u1', role: 'user', content: 'tell me about cats and dogs' }],
    });

    await collect(h.service, 'user-1', {
      message: 'cats and dogs',
      modelId: 'model-1',
      webSearch: true,
    });

    expect(h.wallet.deductCredits).toHaveBeenCalledTimes(2);
    expect(h.wallet.deductCredits).toHaveBeenNthCalledWith(1, 'user-1', 10);
    expect(h.wallet.deductCredits).toHaveBeenNthCalledWith(2, 'user-1', 10);

    // searchCredits accumulated = 20 (10 + 10)
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ searchCredits: 20, status: 'completed' }),
    );
  });

  it('does not deduct when the search fails', async () => {
    const h = buildChatHarness();
    h.pricing.calculateLlmCost = jest.fn().mockResolvedValue(NO_LLM_CHARGE);
    h.pricing.calculateWebSearchCost = jest.fn().mockReturnValue(10);
    h.runtime.stream
      .mockImplementationOnce(async function* () {
        yield toolCallChunk('cats');
      })
      .mockImplementation(async function* () {
        yield contentChunk('I could not search the web.', {
          prompt_tokens: 2,
          completion_tokens: 3,
          total_tokens: 5,
        });
      });
    h.webSearch.search.mockRejectedValue(new Error('provider down'));
    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'u1', role: 'user', content: 'cats' }],
    });

    await collect(h.service, 'user-1', { message: 'cats', modelId: 'model-1', webSearch: true });

    expect(h.wallet.deductCredits).not.toHaveBeenCalled();
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ searchCredits: 0, status: 'completed' }),
    );
  });

  it('does not deduct when the model performs no search', async () => {
    const h = buildChatHarness();
    h.pricing.calculateLlmCost = jest.fn().mockResolvedValue(NO_LLM_CHARGE);
    h.pricing.calculateWebSearchCost = jest.fn().mockReturnValue(10);

    h.runtime.stream.mockImplementation(async function* () {
      yield contentChunk('Answer from what I know.', {
        prompt_tokens: 2,
        completion_tokens: 3,
        total_tokens: 5,
      });
    });

    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'u1', role: 'user', content: 'cats' }],
    });

    await collect(h.service, 'user-1', { message: 'cats', modelId: 'model-1', webSearch: true });

    expect(h.wallet.deductCredits).not.toHaveBeenCalled();
  });

  it('does not deduct when the search is skipped because the time budget is exhausted', async () => {
    const h = buildChatHarness();
    h.pricing.calculateLlmCost = jest.fn().mockResolvedValue(NO_LLM_CHARGE);
    h.pricing.calculateWebSearchCost = jest.fn().mockReturnValue(10);

    // Each successive clock reading is more than the whole turn's search budget
    // apart, so the skip branch is taken regardless of when the loop started.
    const base = Date.now();
    let tick = 0;
    const nowSpy = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => base + tick++ * (WEB_SEARCH_LIMITS.MAX_TOTAL_SEARCH_MS + 1));

    try {
      h.runtime.stream
        .mockImplementationOnce(async function* () {
          yield toolCallChunk('cats');
        })
        .mockImplementation(async function* () {
          yield contentChunk('Answer from what I know.', {
            prompt_tokens: 2,
            completion_tokens: 3,
            total_tokens: 5,
          });
        });
      h.conversations.findById.mockResolvedValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [{ id: 'u1', role: 'user', content: 'cats' }],
      });

      const events = await collect(h.service, 'user-1', {
        message: 'cats',
        modelId: 'model-1',
        webSearch: true,
      });

      expect(h.webSearch.search).not.toHaveBeenCalled();
      expect(h.wallet.deductCredits).not.toHaveBeenCalled();
      expect(searchCompleted(events as ChatStreamEvent[])?.data).toMatchObject({
        sources: 0,
        credits: 0,
      });
      expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
        'usage-1',
        expect.objectContaining({ searchCredits: 0, status: 'completed' }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('deducts nothing when calculateWebSearchCost returns 0 (misconfigured pricing)', async () => {
    const h = buildChatHarness();
    h.pricing.calculateLlmCost = jest.fn().mockResolvedValue(NO_LLM_CHARGE);
    h.pricing.calculateWebSearchCost = jest.fn().mockReturnValue(0);
    h.runtime.stream
      .mockImplementationOnce(async function* () {
        yield toolCallChunk('cats');
      })
      .mockImplementation(async function* () {
        yield contentChunk('Cats are great [S1].', {
          prompt_tokens: 3,
          completion_tokens: 2,
          total_tokens: 5,
        });
      });
    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'u1', role: 'user', content: 'cats' }],
    });

    const events = await collect(h.service, 'user-1', {
      message: 'cats',
      modelId: 'model-1',
      webSearch: true,
    });

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(h.wallet.deductCredits).not.toHaveBeenCalled();
  });
});
