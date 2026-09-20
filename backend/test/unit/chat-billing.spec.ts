// `@nestjs/bullmq` is an ESM module that Jest cannot import under the default
// ts-jest transform. It is pulled in transitively via `files.service.ts` →
// `chat.service.ts`. Mock it at the entry point so the chat billing tests can
// load without this pre-existing environment limitation. (See plan §Task 4.)
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

describe('ChatService billing (Phase 3 §3.1/§3.3/§3.9)', () => {
  it('rejects a paid model before creating a generation when the wallet is empty', async () => {
    const h = buildChatHarness();
    h.wallet.getBalance.mockResolvedValue(0);

    const events = await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { code: 'insufficient_credits' },
    });
    expect(h.conversations.create).not.toHaveBeenCalled();
    expect(h.failover.establish).not.toHaveBeenCalled();
  });

  it('allows an admin to use a priced model without reading or deducting wallet credits', async () => {
    const h = buildChatHarness();
    h.access.loadViewer.mockResolvedValue({ role: 'admin' });
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('admin response', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
      })(),
    );

    const events = await collect(h.service, 'admin-1', { message: 'hi', modelId: 'model-1' });

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(h.wallet.getBalance).not.toHaveBeenCalled();
    expect(h.wallet.deductCreditsWithGrace).not.toHaveBeenCalled();
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ chargedCost: 0, chargedCredits: 0, status: 'completed' }),
    );
  });

  it('deducts the priced credits once for a completed generation and records them', async () => {
    const h = buildChatHarness();
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('hello ', { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
        yield contentChunk('world');
      })(),
    );

    const events = await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(h.wallet.deductCreditsWithGrace).toHaveBeenCalledTimes(1);
    expect(h.wallet.deductCreditsWithGrace).toHaveBeenCalledWith('user-1', 2, 5);
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
        chargedCost: 200,
        chargedCredits: 2,
        status: 'completed',
      }),
    );
    expect(h.wallet.grantCredits).not.toHaveBeenCalled();
  });

  it('passes the assistant message id as the usage identity (§3.9)', async () => {
    const h = buildChatHarness();
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('hello', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
      })(),
    );

    await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(h.usage.create).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', attempts: 1 }),
    );
  });

  it('refunds the deduction when another finalization already claimed the record', async () => {
    const h = buildChatHarness();
    h.usage.finalizeOnce.mockResolvedValue(false); // identity race lost
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('hello', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
      })(),
    );

    await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(h.wallet.deductCreditsWithGrace).toHaveBeenCalledWith('user-1', 2, 5);
    expect(h.wallet.grantCredits).toHaveBeenCalledWith('user-1', 2);
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ chargedCredits: 2 }),
    );
  });

  it('records no charge when the wallet deduction fails', async () => {
    const h = buildChatHarness();
    h.wallet.deductCreditsWithGrace.mockRejectedValue(new Error('boundary consumed'));
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('hello', { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 });
      })(),
    );

    const events = await collect(h.service, 'user-1', { message: 'hi', modelId: 'model-1' });

    expect(events.at(-1)).toMatchObject({ type: 'done' }); // user is not blocked
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ chargedCredits: 0, status: 'completed' }),
    );
    expect(h.wallet.grantCredits).not.toHaveBeenCalled();
  });
});
