import { NotFoundException } from '@nestjs/common';
import { InsufficientCreditsError, WalletService, roundCredits } from './wallet.service';
import type { Wallet } from './entities/wallet.entity';

describe('WalletService', () => {
  let svc: WalletService;
  let repo: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn(async (wallet: Wallet) => wallet),
      update: jest.fn(),
      query: jest.fn(),
    };
    svc = new WalletService(repo as never);
  });

  describe('getBalance', () => {
    it('returns 0 when no wallet exists', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(svc.getBalance('u-1')).resolves.toBe(0);
    });

    it('returns the stored balance as a number', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: '42.5000' });
      await expect(svc.getBalance('u-1')).resolves.toBe(42.5);
    });
  });

  describe('getOrCreateForUser', () => {
    it('returns the existing wallet without writing', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 5 });
      const wallet = await svc.getOrCreateForUser('u-1');
      expect(wallet.creditBalance).toBe(5);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('creates a zero-balance wallet on first access', async () => {
      repo.findOne.mockResolvedValue(null);
      const wallet = await svc.getOrCreateForUser('u-1');
      expect(wallet).toMatchObject({ userId: 'u-1', creditBalance: 0 });
      expect(repo.create).toHaveBeenCalledWith({ userId: 'u-1', creditBalance: 0 });
      expect(repo.save).toHaveBeenCalledWith({ userId: 'u-1', creditBalance: 0 });
    });
  });

  describe('deductCredits', () => {
    it('deducts credits from the balance', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 50 });
      const wallet = await svc.deductCredits('u-1', 20);
      expect(wallet.creditBalance).toBe(30);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', creditBalance: 30 }),
      );
    });

    it('handles fractional credits without float drift', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 10.5 });
      const wallet = await svc.deductCredits('u-1', 3.25);
      expect(wallet.creditBalance).toBe(7.25);
    });

    it('throws InsufficientCreditsError when the balance is too low', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 5 });
      await expect(svc.deductCredits('u-1', 20)).rejects.toThrow('insufficient_credits');
      await expect(svc.deductCredits('u-1', 20)).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('throws wallet_not_found when the user has no wallet row', async () => {
      repo.findOne.mockResolvedValue(null);
      const err = await svc.deductCredits('missing', 1).catch((e) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.getResponse()).toMatchObject({ code: 'wallet_not_found' });
    });

    it('rejects a negative amount instead of silently granting', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 5 });
      await expect(svc.deductCredits('u-1', -10)).rejects.toThrow('non-negative');
    });
  });

  describe('grantCredits', () => {
    it('adds credits to an existing balance', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 0 });
      const wallet = await svc.grantCredits('u-1', 100);
      expect(wallet.creditBalance).toBe(100);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1', creditBalance: 100 }),
      );
    });

    it('creates the wallet when it does not exist yet', async () => {
      repo.findOne.mockResolvedValue(null);
      const wallet = await svc.grantCredits('u-1', 25.5);
      expect(wallet.creditBalance).toBe(25.5);
    });

    it('accumulates fractional grants exactly', async () => {
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 0.1 });
      const wallet = await svc.grantCredits('u-1', 0.2);
      expect(wallet.creditBalance).toBe(0.3);
    });
  });

  describe('deductCreditsWithGrace', () => {
    it('deducts atomically and returns the updated wallet with a numeric balance', async () => {
      repo.query
        .mockResolvedValueOnce([]) // race-free wallet creation (INSERT ... DO NOTHING)
        .mockResolvedValueOnce([{ id: 'w-1', userId: 'u-1', creditBalance: '47.5000' }]);

      const wallet = await svc.deductCreditsWithGrace('u-1', 2.5, 5);

      expect(wallet).toMatchObject({ userId: 'u-1', creditBalance: 47.5 });
      expect(repo.query).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('UPDATE wallets'),
        [2.5, 'u-1', -5],
      );
    });

    it('allows the balance to land exactly on the grace floor', async () => {
      repo.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'w-1', userId: 'u-1', creditBalance: '-5.0000' }]);

      const wallet = await svc.deductCreditsWithGrace('u-1', 5, 5);

      expect(wallet.creditBalance).toBe(-5);
    });

    it('throws InsufficientCreditsError when the floor would be crossed', async () => {
      repo.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]); // UPDATE matched no row
      repo.findOne.mockResolvedValue({ userId: 'u-1', creditBalance: 1 });

      await expect(svc.deductCreditsWithGrace('u-1', 10, 5)).rejects.toBeInstanceOf(
        InsufficientCreditsError,
      );
    });

    it('rejects a negative amount and a negative grace without touching the database', async () => {
      await expect(svc.deductCreditsWithGrace('u-1', -1, 5)).rejects.toThrow('non-negative');
      await expect(svc.deductCreditsWithGrace('u-1', 1, -1)).rejects.toThrow('Grace must be');
      expect(repo.query).not.toHaveBeenCalled();
    });
  });

  describe('roundCredits', () => {
    it('rounds half-up at the wallet scale and normalizes negative zero', () => {
      expect(roundCredits(0.00005)).toBe(0.0001);
      expect(roundCredits(0.00004)).toBe(0);
      expect(roundCredits(-0)).toBe(0);
    });
  });

  describe('grantCreditsWithin', () => {
    it('upserts the balance through the caller-provided manager', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValue([{ id: 'w-1', userId: 'u-1', creditBalance: '125.0000' }]),
      };

      const wallet = await svc.grantCreditsWithin(manager as never, 'u-1', 25);

      expect(wallet.creditBalance).toBe(125);
      expect(manager.query).toHaveBeenCalledTimes(1);
      const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('ON CONFLICT (user_id) DO UPDATE');
      expect(params).toEqual(['u-1', 25]);
    });

    it('rounds the granted amount to the wallet scale', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValue([{ id: 'w-1', userId: 'u-1', creditBalance: '0.0001' }]),
      };

      await svc.grantCreditsWithin(manager as never, 'u-1', 0.00012);

      const [, params] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(params).toEqual(['u-1', 0.0001]);
    });

    it('rejects a negative amount before touching the database', async () => {
      const manager = { query: jest.fn() };

      await expect(svc.grantCreditsWithin(manager as never, 'u-1', -5)).rejects.toThrow(
        'non-negative',
      );
      expect(manager.query).not.toHaveBeenCalled();
    });
  });
});
