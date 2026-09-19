import { UsageService } from '../../src/modules/usage/usage.service';

describe('UsageService', () => {
  let service: UsageService;
  let mockRepo: any;

  beforeEach(() => {
    mockRepo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => ({ id: 'usage-1', ...data })),
      findOne: jest.fn(),
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

  describe('finalize', () => {
    it('persists tokens, reasoning, and the charged amounts', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'usage-1',
        modelId: 'model-1',
        status: 'pending',
      });

      await service.finalize('usage-1', {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        reasoningTokens: 10,
        chargedCost: 200,
        chargedCredits: 2,
        status: 'completed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
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

    it('defaults reasoning tokens to zero when omitted', async () => {
      mockRepo.findOne.mockResolvedValue({ id: 'usage-1', status: 'pending' });

      await service.finalize('usage-1', {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        chargedCost: 0,
        chargedCredits: 0,
        status: 'completed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reasoningTokens: 0 }),
      );
    });

    it('never charges a failed request, even if amounts are supplied', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'usage-1',
        modelId: 'model-1',
        status: 'pending',
      });

      await service.finalize('usage-1', {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        chargedCost: 999,
        chargedCredits: 9,
        status: 'failed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed', chargedCost: 0, chargedCredits: 0 }),
      );
    });

    it('does nothing if record not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await service.finalize('nonexistent', {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        chargedCost: 0,
        chargedCredits: 0,
        status: 'completed',
      });
      expect(mockRepo.save).not.toHaveBeenCalled();
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
