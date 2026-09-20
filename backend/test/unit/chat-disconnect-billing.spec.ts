jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => jest.fn() }));
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue({}), close: jest.fn().mockResolvedValue(undefined) })) }));

import {
  buildChatHarness,
  collect,
  contentChunk,
  until,
} from './helpers/chat-stream-harness';

describe('ChatService failure and disconnect guarantees (§3.4, §3.7)', () => {
  it('charges nothing for a failed generation but still records the failed usage', async () => {
    const h = buildChatHarness();
    h.runtime.stream.mockRejectedValue(new Error('provider exploded'));

    const events = await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events.at(-1)).toMatchObject({ type: 'error', data: { code: 'provider_error' } });
    expect(h.wallet.deductCreditsWithGrace).not.toHaveBeenCalled();
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ status: 'failed', chargedCost: 0, chargedCredits: 0 }),
    );
  });

  it('completes and charges the generation after the client disconnects mid-stream', async () => {
    const h = buildChatHarness();
    let releaseSecond!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('first ');
        await gate;
        yield contentChunk('second', {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        });
      })(),
    );

    const events: unknown[] = [];
    const subscription = h.service
      .streamChat('user-1', { message: 'hi', modelId: 'model-1' } as never)
      .subscribe({ next: (e) => events.push(e) });

    // Wait until the first chunk arrived, then simulate the client leaving.
    await until(() => events.length > 0);
    subscription.unsubscribe();
    releaseSecond();

    // The server-side generation must still finish, persist, and charge.
    await until(() => h.conversations.completeIfStreaming.mock.calls.length > 0);
    await until(() => h.usage.finalizeOnce.mock.calls.length > 0);

    expect(h.conversations.completeIfStreaming).toHaveBeenCalledWith(
      'msg-1',
      'first second',
      [],
      expect.anything(),
    );
    expect(h.wallet.deductCreditsWithGrace).toHaveBeenCalledWith('user-1', 2, 5);
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ chargedCredits: 2, status: 'completed' }),
    );
  });
});
