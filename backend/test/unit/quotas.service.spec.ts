import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuotaService } from '../../src/modules/quotas/quotas.service';
import { Quota } from '../../src/modules/quotas/entities/quota.entity';
import { QuotaRule } from '../../src/modules/quotas/entities/quota-rule.entity';
import { User } from '../../src/modules/users/entities/user.entity';

describe('QuotaService', () => {
  let service: QuotaService;
  // Typed loosely on purpose: the repository surface is mocked per-test and
  // typed as `any` so the unbound-method lint rule does not fire on asserts.
  let mockRepo: any;
  let mockRuleRepo: any;
  let mockUserRepo: any;

  beforeEach(async () => {
    mockRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1, generatedMaps: [], raw: 'UPDATE' }),
      createQueryBuilder: jest.fn(),
    } as any;
    mockRuleRepo = { findOne: jest.fn().mockResolvedValue({ tier: 'free', tokenLimit: 100000 }) };
    mockUserRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'user-1', role: 'user', accessTier: 'free' }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        QuotaService,
        { provide: getRepositoryToken(Quota), useValue: mockRepo },
        { provide: getRepositoryToken(QuotaRule), useValue: mockRuleRepo },
        { provide: getRepositoryToken(User), useValue: mockUserRepo },
      ],
    }).compile();

    service = moduleRef.get(QuotaService);
  });

  describe('getForUser', () => {
    it('returns quota for existing user', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 45000,
        lastResetAt: new Date(),
      } as Quota);

      const result = await service.getForUser('user-1');
      expect(result).toEqual({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 45000,
        tokenRemaining: 55000,
        lastResetAt: expect.any(Date),
      });
    });

    it('creates the quota row on first read', async () => {
      mockRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'q-new',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 0,
        lastResetAt: null,
      } as Quota);
      mockRepo.create.mockReturnValue({
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 0,
      } as Quota);
      mockRepo.save.mockResolvedValue({
        id: 'q-new',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 0,
      } as Quota);

      const result = await service.getForUser('user-1');
      expect(result?.tokenRemaining).toBe(100000);
      expect(mockRepo.create).toHaveBeenCalled();
    });
  });

  describe('checkAndReserve', () => {
    it('reserves quota when sufficient', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 45000,
      } as Quota);

      mockRepo.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      } as any);

      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 45500,
      } as Quota);

      const result = await service.checkAndReserve('user-1', 500);
      expect(result.reserved).toBe(true);
      expect(result.quotaId).toBe('q1');
      expect(result.tokenRemaining).toBe(54500);
    });

    it('rejects when quota insufficient', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 99900,
      } as Quota);

      mockRepo.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 0 }),
      } as any);

      const result = await service.checkAndReserve('user-1', 500);
      expect(result.reserved).toBe(false);
      expect(result.reason).toBe('quota_exceeded');
      expect(result.tokenRemaining).toBe(100);
    });

    it('creates quota if not exists', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      mockRepo.create.mockReturnValue({
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 0,
      } as Quota);

      mockRepo.save.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 0,
      } as Quota);

      mockRepo.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 1 }),
      } as any);

      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 0,
      } as Quota);

      const result = await service.checkAndReserve('user-1', 0);
      expect(result.reserved).toBe(true);
      expect(result.quotaId).toBe('q1');
    });

    it('returns success for admin users (tokenLimit=0)', async () => {
      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'admin-1',
        tokenLimit: 0,
        tokenUsed: 0,
      } as Quota);

      const result = await service.checkAndReserve('admin-1', 5000);
      expect(result.reserved).toBe(true);
      expect(result.reason).toBe('admin_unlimited');
    });
  });

  describe('finalize', () => {
    it('corrects the estimate: currentUsed - reserved + actual', async () => {
      // currentUsed=45500, reserved=500 (estimated), actual=350 (provider-reported)
      // new tokenUsed = 45500 - 500 + 350 = 45350
      mockRepo.findOne.mockResolvedValue({
        id: 'q1',
        userId: 'user-1',
        tokenLimit: 100000,
        tokenUsed: 45500,
      } as Quota);

      await service.finalize('q1', 500, 350);
      expect(mockRepo.update).toHaveBeenCalledWith('q1', { tokenUsed: 45350 });
    });

    it('does nothing if no quota found', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      await service.finalize('nonexistent', 100, 50);
      expect(mockRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('releases reserved tokens', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 1 });
      mockRepo.createQueryBuilder.mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        execute,
      } as any);

      await service.refund('q1', 500);
      expect(execute).toHaveBeenCalled();
    });
  });
});
