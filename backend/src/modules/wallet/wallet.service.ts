import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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

  /**
   * Add Credits using the caller's transaction.
   *
   * The caller MUST already hold the lock that makes the grant happen exactly
   * once (for a purchase, the `UPDATE payments ... WHERE status = 'PENDING'`
   * guard). This method guarantees the wallet mutation itself is atomic: it
   * never read-modify-writes, it increments in place, so a concurrent chat
   * spend cannot interleave into a lost update.
   */
  async grantCreditsWithin(
    manager: EntityManager,
    userId: string,
    amount: number,
  ): Promise<Wallet> {
    this.assertValidAmount(amount);

    // `EntityManager.query` is untyped (`any`), so the row shape is declared
    // here rather than cast afterwards — the cast would be a no-op.
    const rows: Array<{ id: string; userId: string; creditBalance: string }> =
      await manager.query(
        `INSERT INTO wallets (id, user_id, credit_balance, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, now(), now())
       ON CONFLICT (user_id) DO UPDATE
         SET credit_balance = wallets.credit_balance + EXCLUDED.credit_balance,
             updated_at = now()
       RETURNING id, user_id AS "userId", credit_balance AS "creditBalance"`,
        [userId, roundCredits(amount)],
      );

    const row = rows[0];
    return { ...row, creditBalance: Number(row.creditBalance) } as Wallet;
  }

  /**
   * Spend Credits with a bounded overdraft, for chat generations (spec Phase 3
   * §3.8): a turn may push the balance as low as `-graceCredits` but never
   * below it.
   *
   * The floor rides inside the same UPDATE that applies the deduction, so a
   * concurrent spend cannot slip the balance below the boundary between a
   * check and a write. Wallet creation is race-free (INSERT ... ON CONFLICT
   * DO NOTHING) so a first-ever generation can still charge within the grace.
   * Throws `InsufficientCreditsError` when the boundary is already consumed.
   */
  async deductCreditsWithGrace(
    userId: string,
    amount: number,
    graceCredits: number,
  ): Promise<Wallet> {
    this.assertValidAmount(amount);
    if (graceCredits < 0) {
      throw new UnprocessableEntityException({
        code: 'invalid_amount',
        message: 'Grace must be a non-negative number of credits.',
      });
    }

    await this.repo.query(
      `INSERT INTO wallets (id, user_id, credit_balance, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 0, now(), now())
       ON CONFLICT (user_id) DO NOTHING`,
      [userId],
    );

    const rows: Array<{ id: string; userId: string; creditBalance: string }> =
      await this.repo.query(
        `UPDATE wallets
         SET credit_balance = credit_balance - $1, updated_at = now()
         WHERE user_id = $2 AND credit_balance - $1 >= $3
         RETURNING id, user_id AS "userId", credit_balance AS "creditBalance"`,
        [roundCredits(amount), userId, -graceCredits],
      );

    const row = rows[0];
    if (!row) {
      throw new InsufficientCreditsError(await this.getBalance(userId), amount);
    }
    return { ...row, creditBalance: Number(row.creditBalance) } as Wallet;
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
