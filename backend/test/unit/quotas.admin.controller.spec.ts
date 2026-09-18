import { QuotasAdminController } from '../../src/modules/quotas/quotas.admin.controller';

describe('QuotasAdminController', () => {
  let controller: QuotasAdminController;
  let mockRepo: any;

  const rule = {
    id: 'rule-1',
    tier: 'free',
    tokenLimit: 100000,
    label: 'Free tier',
    createdAt: new Date('2026-09-18T00:00:00Z'),
  };

  beforeEach(() => {
    mockRepo = {
      find: jest.fn().mockResolvedValue([rule]),
      findOne: jest.fn().mockResolvedValue(rule),
      create: jest.fn((data) => ({ ...rule, ...data })),
      save: jest.fn(async (data) => data),
    };
    controller = new QuotasAdminController(mockRepo);
  });

  it('list returns all rules in API shape', async () => {
    const result = await controller.list();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual({
      id: 'rule-1',
      tier: 'free',
      tokenLimit: 100000,
      label: 'Free tier',
      createdAt: '2026-09-18T00:00:00.000Z',
    });
  });

  it('create persists a new rule', async () => {
    const result = await controller.create({
      tier: 'commercial',
      tokenLimit: 1000000,
      label: 'Commercial tier',
    });
    expect(mockRepo.create).toHaveBeenCalledWith({
      tier: 'commercial',
      tokenLimit: 1000000,
      label: 'Commercial tier',
    });
    expect(result.tier).toBe('commercial');
    expect(result.tokenLimit).toBe(1000000);
  });

  it('update patches an existing rule', async () => {
    const result = await controller.update('rule-1', { tokenLimit: 200000 });
    expect(result.tokenLimit).toBe(200000);
    expect(mockRepo.save).toHaveBeenCalled();
  });

  it('update throws 404 when the rule does not exist', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    await expect(controller.update('missing', { tokenLimit: 1 })).rejects.toThrow();
  });
});
