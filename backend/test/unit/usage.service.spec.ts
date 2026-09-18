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
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getRawOne: jest.fn().mockResolvedValue({ totalTokens: 0, totalCost: 0, requestCount: 0 }),
      })),
    };
    service = new UsageService(mockRepo);
  });

  describe('calculateCost', () => {
    it('returns 0 when both prices are 0', () => {
      const cost = service.calculateCost(100, 50, 0, 0);
      expect(cost).toBe(0);
    });

    it('calculates cost from input and output prices', () => {
      // $0.01 per 1k input, $0.03 per 1k output
      // 100 input tokens = 0.1k * $0.01 = $0.001
      // 50 output tokens = 0.05k * $0.03 = $0.0015
      // Total = $0.0025
      const cost = service.calculateCost(100, 50, 0.01, 0.03);
      expect(cost).toBeCloseTo(0.0025, 8);
    });

    it('handles zero tokens gracefully', () => {
      const cost = service.calculateCost(0, 0, 0.01, 0.03);
      expect(cost).toBe(0);
    });
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
    it('updates usage record with token counts and cost', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'usage-1',
        modelId: 'model-1',
        status: 'pending',
      });

      await service.finalize('usage-1', {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        inputPricePer1k: 0.01,
        outputPricePer1k: 0.03,
        status: 'completed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          status: 'completed',
          completedAt: expect.any(Date),
        }),
      );
    });

    it('marks as failed when status is failed', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'usage-1',
        modelId: 'model-1',
        status: 'pending',
      });

      await service.finalize('usage-1', {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        status: 'failed',
      });

      expect(mockRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('does nothing if record not found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await service.finalize('nonexistent', {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
        status: 'completed',
      });
      expect(mockRepo.save).not.toHaveBeenCalled();
    });
  });
});
