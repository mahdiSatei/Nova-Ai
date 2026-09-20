import { UsageService } from '../../src/modules/usage/usage.service';

describe('UsageService message identity', () => {
  it('persists messageId when provided, so the unique index keys usage to one generation', async () => {
    const repo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new UsageService(repo as never);

    await service.create({
      userId: 'user-1',
      conversationId: 'conv-1',
      modelId: 'model-1',
      providerId: 'prov-1',
      messageId: 'msg-1',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'msg-1', status: 'pending', attempts: 1 }),
    );
  });

  it('leaves messageId unset for requests that never reached a message', async () => {
    const repo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const service = new UsageService(repo as never);

    await service.create({
      userId: 'user-1',
      conversationId: 'conv-1',
      modelId: 'model-1',
      providerId: 'prov-1',
    });

    expect(repo.create).toHaveBeenCalledWith(
      expect.not.objectContaining({ messageId: expect.anything() }),
    );
  });
});
