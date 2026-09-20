jest.mock('@nestjs/bullmq', () => ({ InjectQueue: () => jest.fn() }));
jest.mock('bullmq', () => ({ Queue: jest.fn().mockImplementation(() => ({ add: jest.fn().mockResolvedValue({}), close: jest.fn().mockResolvedValue(undefined) })) }));

import { ChatService } from '../../src/modules/chat/chat.service';
import { buildChatHarness, contentChunk } from './helpers/chat-stream-harness';

function collectRetry(
  service: ChatService,
  conversationId: string,
  failedMessageId: string,
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    service
      .retryGenerationStream('user-1', conversationId, failedMessageId, false, false)
      .subscribe({
        next: (e) => events.push(e),
        error: reject,
        complete: () => resolve(events),
      });
  });
}

describe('ChatService regenerate billing (§3.6)', () => {
  it('creates a new usage record for the new generation and charges it', async () => {
    const h = buildChatHarness();
    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'msg-old', role: 'user', content: 'hi', status: 'failed' }],
    });
    h.conversations.appendMessage.mockResolvedValue({ id: 'msg-new' });
    h.runtime.stream.mockResolvedValue(
      (async function* () {
        yield contentChunk('retry answer', {
          prompt_tokens: 4,
          completion_tokens: 3,
          total_tokens: 7,
        });
      })(),
    );

    const events = await collectRetry(h.service, 'conv-1', 'msg-old');

    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(h.usage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        conversationId: 'conv-1',
        messageId: 'msg-new',
        attempts: 1,
      }),
    );
    expect(h.wallet.deductCreditsWithGrace).toHaveBeenCalledTimes(1);
    expect(h.usage.finalizeOnce).toHaveBeenCalledWith(
      'usage-1',
      expect.objectContaining({ chargedCredits: 2, status: 'completed' }),
    );
  });

  it('charges nothing when the retried generation fails (§3.7 via retry)', async () => {
    const h = buildChatHarness();
    h.conversations.findById.mockResolvedValue({
      id: 'conv-1',
      userId: 'user-1',
      messages: [{ id: 'msg-old', role: 'user', content: 'hi', status: 'failed' }],
    });
    h.conversations.appendMessage.mockResolvedValue({ id: 'msg-new' });
    h.runtime.stream.mockRejectedValue(new Error('provider down'));

    const events = await collectRetry(h.service, 'conv-1', 'msg-old');

    expect(events.at(-1)).toMatchObject({ type: 'error', data: { code: 'provider_error' } });
    expect(h.wallet.deductCreditsWithGrace).not.toHaveBeenCalled();
  });
});
