import { getMetadataArgsStorage } from 'typeorm';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';

function column(name: string, target: object) {
  const found = getMetadataArgsStorage().columns.find(
    (c) => c.target === target && c.propertyName === name,
  );
  if (!found) throw new Error(`${target.constructor.name}.${name} is not a mapped column`);
  return found.options;
}

function build() {
  const messageRepo = {
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    findOne: jest.fn().mockResolvedValue({ id: 'm1' }),
    create: jest.fn((value: unknown) => value),
    save: jest.fn(async (value: unknown) => value),
  };
  const conversationRepo = { findOne: jest.fn(), update: jest.fn() };
  return {
    // Constructor order is (conversationRepo, messageRepo).
    service: new ConversationsService(conversationRepo as never, messageRepo as never),
    messageRepo,
  };
}

describe('Message reasoning columns', () => {
  it('maps nullable reasoning_summary and reasoning_enabled', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Message } = require('../../src/modules/conversations/entities/message.entity');
    expect(column('reasoningSummary', Message)).toMatchObject({
      name: 'reasoning_summary',
      type: 'text',
      nullable: true,
    });
    expect(column('reasoningEnabled', Message)).toMatchObject({
      name: 'reasoning_enabled',
      type: 'boolean',
      default: false,
    });
  });
});

describe('ConversationsService.completeIfStreaming reasoning', () => {
  it('persists the provider summary together with the content', async () => {
    const { service, messageRepo } = build();

    const ok = await service.completeIfStreaming('m1', 'answer', [], {
      enabled: true,
      summary: 'why the answer is what it is',
    });

    expect(ok).toBe(true);
    expect(messageRepo.update).toHaveBeenCalledWith(
      { id: 'm1', status: 'streaming' },
      {
        status: 'completed',
        content: 'answer',
        citations: [],
        reasoningEnabled: true,
        reasoningSummary: 'why the answer is what it is',
      },
    );
  });

  it('stores no summary for a reasoning turn that exposed none', async () => {
    const { service, messageRepo } = build();
    await service.completeIfStreaming('m1', 'answer', [], { enabled: true, summary: null });
    expect(messageRepo.update).toHaveBeenCalledWith(
      { id: 'm1', status: 'streaming' },
      expect.objectContaining({ reasoningEnabled: true, reasoningSummary: null }),
    );
  });

  it('defaults to no reasoning for calls that do not pass it', async () => {
    const { service, messageRepo } = build();
    await service.completeIfStreaming('m1', 'answer');
    expect(messageRepo.update).toHaveBeenCalledWith(
      { id: 'm1', status: 'streaming' },
      expect.objectContaining({ reasoningEnabled: false, reasoningSummary: null }),
    );
  });

  it('leaves reasoning columns alone when a message fails', async () => {
    const { service, messageRepo } = build();
    await service.updateMessageStatus('m1', 'failed', 'partial');
    const patch = messageRepo.update.mock.calls[0][1] as Record<string, unknown>;
    expect(patch.status).toBe('failed');
    expect(patch.reasoningSummary).toBeUndefined();
    expect(patch.reasoningEnabled).toBeUndefined();
  });
});
