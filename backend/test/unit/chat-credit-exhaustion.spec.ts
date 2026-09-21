jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => jest.fn() }));
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue({}), close: jest.fn().mockResolvedValue(undefined) })) }));

import { buildChatHarness, collect, contentChunk } from './helpers/chat-stream-harness';

describe('ChatService credit exhaustion (§3.8)', () => {
  function exhaustedHarness() {
    const h = buildChatHarness();
    // 0.02 credits/token; balance 2 → boundary 7 → ~350 estimated tokens trip it.
    h.pricing.getOutputCreditRate.mockResolvedValue(0.02);
    h.wallet.getBalance.mockResolvedValue(2);
    h.pricing.calculateLlmCost.mockResolvedValue({ chargedCost: 400, chargedCredits: 20 });
    return h;
  }

  it('stops generation past the boundary, saves the partial answer, and notifies the user', async () => {
    const h = exhaustedHarness();
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('a'.repeat(3000));
        yield contentChunk('b'.repeat(3000)); // estimate crosses the boundary here
        yield contentChunk('c'.repeat(3000)); // never reached
      })(),
    );

    const events = await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    // Terminal frame is the dedicated notification, not `done`.
    expect(events.at(-1)).toMatchObject({ type: 'error', data: { code: 'credit_exhausted' } });
    expect(events.some((e) => (e as { type?: string }).type === 'done')).toBe(false);

    // Partial answer persisted as a completed message.
    expect(h.conversations.completeIfStreaming).toHaveBeenCalledTimes(1);
    const [messageId, partial] = h.conversations.completeIfStreaming.mock.calls[0];
    expect(messageId).toBe('msg-1');
    expect((partial as string).length).toBe(3000);

    // Charge is finalized from estimates and capped at the boundary (2 + 5).
    expect(h.pricing.calculateLlmCost).toHaveBeenCalledWith('model-1', 0, 1000, 0);
    expect(h.wallet.deductCreditsWithGrace).toHaveBeenCalledWith('user-1', 7, 5);
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({
        inputTokens: 0,
        outputTokens: 1000,
        chargedCredits: 7,
        status: 'completed',
      }),
    );
  });

  it('does not stop the stream when credit pricing is misconfigured (rate 0)', async () => {
    const h = exhaustedHarness();
    h.pricing.getOutputCreditRate.mockResolvedValue(0); // budget disabled
    h.pricing.calculateLlmCost.mockResolvedValue({ chargedCost: 0, chargedCredits: 0 });
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('a'.repeat(3000));
        yield contentChunk('b'.repeat(3000));
      })(),
    );

    const events = await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(h.conversations.completeIfStreaming).toHaveBeenCalledWith(
      'msg-1',
      'a'.repeat(3000) + 'b'.repeat(3000),
      [],
      expect.anything(),
    );
  });
});
