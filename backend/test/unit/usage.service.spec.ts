import { UsageService } from '../../src/modules/usage/usage.service';

describe('UsageService', () => {
  let service: UsageService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'usage-1', ...data })),
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => ({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getRawOne: jest.fn().mockResolvedValue({
          totalTokens: '150',
          totalCost: '200',
          totalCredits: '2',
          requestCount: '1',
        }),
      })),
    };
    service = new UsageService(mockRepo);
  });

  describe('create', () => {
    it('creates a pending usage record', async () => {
      const record = await service.create({
        userId: 'user-1',
        conversationId: 'conv-1',
        modelId: 'model-1',
        providerId: 'prov-1',
      });
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          conversationId: 'conv-1',
          modelId: 'model-1',
          providerId: 'prov-1',
          status: 'pending',
        }),
      );
      expect(mockRepo.save).toHaveBeenCalled();
      expect(record.status).toBe('pending');
    });
  });

  describe('finalizeOnce', () => {
    const completedInput = {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: 10,
      chargedCost: 200,
      chargedCredits: 2,
      status: 'completed' as const,
    };

    it('atomically finalizes a pending record and reports success', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      const recorded = await service.finalizeOnce('usage-1', completedInput);

      expect(recorded).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'usage-1', status: 'pending' },
        expect.objectContaining({
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          reasoningTokens: 10,
          chargedCost: 200,
          chargedCredits: 2,
          status: 'completed',
          completedAt: expect.any(Date),
        }),
      );
    });

    it('reports false and writes nothing when the record is no longer pending', async () => {
      mockRepo.update.mockResolvedValue({ affected: 0 });

      const recorded = await service.finalizeOnce('usage-1', completedInput);

      expect(recorded).toBe(false);
    });

    it('forces cost and credits to zero for a failed status', async () => {
      mockRepo.update.mockResolvedValue({ affected: 1 });

      await service.finalizeOnce('usage-1', {
        ...completedInput,
        status: 'failed' as const,
        chargedCost: 999,
        chargedCredits: 7,
      });

      expect(mockRepo.update).toHaveBeenCalledWith(
        { id: 'usage-1', status: 'pending' },
        expect.objectContaining({ status: 'failed', chargedCost: 0, chargedCredits: 0 }),
      );
    });
  });

  describe('listForAdmin', () => {
    it('reports token, Toman cost, and Credit totals', async () => {
      const result = await service.listForAdmin({ limit: 20, offset: 0 });
      expect(result.totals).toEqual({
        totalTokens: 150,
        totalCost: 200,
        totalCredits: 2,
        requestCount: 1,
      });
    });
  });
});
