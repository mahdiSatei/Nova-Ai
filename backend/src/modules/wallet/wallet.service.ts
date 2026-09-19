import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

/**
 * 1 Credit = 10,000 sub-credit units, matching the wallet column's `scale: 4`.
 * Every mutation rounds through this scale so repeated grants/deductions cannot
 * accumulate binary-float drift.
 */
export const MCREDITS_PER_CREDIT = 10_000;

/** Round to the wallet's fixed precision (half-up), normalizing `-0` to `0`. */
export function roundCredits(value: number): number {
  const rounded = Math.round(value * MCREDITS_PER_CREDIT) / MCREDITS_PER_CREDIT;
  return rounded === 0 ? 0 : rounded;
}

/** Raised when a spend would take the wallet below zero. */
export class InsufficientCreditsError extends Error {
  constructor(
    public readonly balance: number,
    public readonly required: number,
  ) {
    super('insufficient_credits');
    this.name = 'InsufficientCreditsError';
  }
}

/**
 * The only writer of wallet balances (Phase 5 §1.8).
 *
 * Consumers (chat billing, Phase 2 purchase flows) must go through this service
 * rather than touching the `wallets` table, so the "never negative" invariant
 * and the rounding rule live in exactly one place.
 */
@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private readonly repo: Repository<Wallet>,
  ) {}

  /** Current balance in Credits; 0 when the user has no wallet yet. */
  async getBalance(userId: string): Promise<number> {
    const wallet = await this.repo.findOne({ where: { userId } });
    return wallet ? Number(wallet.creditBalance) : 0;
  }

  /** Lazy-create the wallet on first access. */
  async getOrCreateForUser(userId: string): Promise<Wallet> {
    const existing = await this.repo.findOne({ where: { userId } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ userId, creditBalance: 0 }));
  }

  /**
   * Spend Credits. Throws `InsufficientCreditsError` (never a silent clamp)
   * when the balance would go negative, and 404 `wallet_not_found` when the
   * user has no wallet row at all.
   */
  async deductCredits(userId: string, amount: number): Promise<Wallet> {
    this.assertValidAmount(amount);

    const wallet = await this.repo.findOne({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException({ code: 'wallet_not_found', message: 'Wallet not found.' });
    }

    const balance = Number(wallet.creditBalance);
    const next = roundCredits(balance - amount);
    if (next < 0) {
      throw new InsufficientCreditsError(balance, amount);
    }

    wallet.creditBalance = next;
    return this.repo.save(wallet);
  }

  /** Add Credits, creating the wallet if needed. Returns the updated wallet. */
  async grantCredits(userId: string, amount: number): Promise<Wallet> {
    this.assertValidAmount(amount);

    const wallet = await this.getOrCreateForUser(userId);
    wallet.creditBalance = roundCredits(Number(wallet.creditBalance) + amount);
    return this.repo.save(wallet);
  }

  private assertValidAmount(amount: number): void {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0) {
      throw new UnprocessableEntityException({
        code: 'invalid_amount',
        message: 'Credit amount must be a finite, non-negative number.',
      });
    }
  }
}
