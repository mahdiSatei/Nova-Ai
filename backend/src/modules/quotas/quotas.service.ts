import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Quota } from './entities/quota.entity';
import { QuotaRule } from './entities/quota-rule.entity';
import { User } from '../users/entities/user.entity';

/** Fallback when no rule matches the tier. */
const FALLBACK_TOKEN_LIMIT = 100000;

export interface QuotaSnapshot {
  id: string;
  userId: string;
  tokenLimit: number;
  tokenUsed: number;
  tokenRemaining: number;
  lastResetAt: Date | null;
}

export interface ReserveResult {
  reserved: boolean;
  quotaId: string;
  newTokenUsed?: number;
  tokenRemaining: number;
  reason?: 'quota_exceeded' | 'admin_unlimited';
}

@Injectable()
export class QuotaService {
  constructor(
    @InjectRepository(Quota)
    private readonly repo: Repository<Quota>,
    @InjectRepository(QuotaRule)
    private readonly ruleRepo: Repository<QuotaRule>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Snapshot the user's quota, creating the row on first read so a user can
   * always see their balance before their first request.
   */
  async getForUser(userId: string): Promise<QuotaSnapshot | null> {
    // If the user no longer exists (deleted after JWT issuance),
    // creating a quota row would violate the foreign-key constraint.
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) return null;

    let quota = await this.repo.findOne({ where: { userId } });
    if (!quota) {
      const tokenLimit = await this.resolveTokenLimitForUser(user);
      quota = await this.repo.save(
        this.repo.create({ userId, tokenLimit, tokenUsed: 0 }),
      );
    }

    return {
      id: quota.id,
      userId: quota.userId,
      tokenLimit: Number(quota.tokenLimit),
      tokenUsed: Number(quota.tokenUsed),
      tokenRemaining: Number(quota.tokenLimit) - Number(quota.tokenUsed),
      lastResetAt: quota.lastResetAt,
    };
  }

  async checkAndReserve(
    userId: string,
    estimatedTokens: number,
  ): Promise<ReserveResult> {
    let quota = await this.repo.findOne({ where: { userId } });

    if (!quota) {
      const user = await this.userRepo.findOne({ where: { id: userId } });
      const tokenLimit = await this.resolveTokenLimitForUser(user);
      quota = this.repo.create({ userId, tokenLimit, tokenUsed: 0 });
      quota = await this.repo.save(quota);
    }

    const tokenLimit = Number(quota.tokenLimit);
    const tokenUsed = Number(quota.tokenUsed);

    // 0 means no limit (admin/unlimited)
    if (tokenLimit === 0) {
      return {
        reserved: true,
        quotaId: quota.id,
        tokenRemaining: Infinity,
        reason: 'admin_unlimited',
      };
    }

    // Atomic check-and-update. The increment is expressed relative to the
    // stored value (`token_used + :estimated`) so concurrent reservations
    // cannot both write the same absolute value and bypass the limit.
    const updated = await this.repo
      .createQueryBuilder()
      .update(Quota)
      .set({ tokenUsed: () => 'token_used + :estimated' })
      .where('id = :id AND token_used + :estimated <= token_limit')
      .setParameters({ id: quota.id, estimated: estimatedTokens })
      .execute();

    if (updated.affected === 0) {
      return {
        reserved: false,
        quotaId: quota.id,
        tokenRemaining: tokenLimit - tokenUsed,
        reason: 'quota_exceeded',
      };
    }

    const fresh = await this.repo.findOne({ where: { id: quota.id } });
    const updatedTokenUsed = fresh ? Number(fresh.tokenUsed) : tokenUsed + estimatedTokens;

    return {
      reserved: true,
      quotaId: quota.id,
      newTokenUsed: updatedTokenUsed,
      tokenRemaining: tokenLimit - updatedTokenUsed,
    };
  }

  /**
   * Resolve the effective token limit for a user from the admin-configured
   * quota rules: admins are unlimited (0), otherwise the rule for the user's
   * access tier applies.
   */
  private async resolveTokenLimitForUser(user: User | null): Promise<number> {
    if (user?.role === 'admin') return 0;

    const tier = user?.accessTier ?? 'free';
    const rule = await this.ruleRepo.findOne({ where: { tier } });
    return rule ? Number(rule.tokenLimit) : FALLBACK_TOKEN_LIMIT;
  }

  /**
   * Finalize a reservation: replace the estimated increment with the actual
   * token count for this request. `reservedTokens` is what was atomically
   * added by `checkAndReserve`; `actualTokens` is the provider-reported
   * total. The new value is:
   *     currentUsed − reservedTokens + actualTokens
   * i.e. undo the estimate and apply the real count.
   */
  async finalize(
    quotaId: string,
    reservedTokens: number,
    actualTokens: number,
  ): Promise<void> {
    const quota = await this.repo.findOne({ where: { id: quotaId } });
    if (!quota) return;

    const currentUsed = Number(quota.tokenUsed);
    const corrected = Math.max(0, currentUsed - reservedTokens + actualTokens);
    if (corrected !== currentUsed) {
      await this.repo.update(quotaId, { tokenUsed: corrected });
    }
  }

  /** Release a reservation after a failed request (never negative). */
  async refund(quotaId: string, reservedTokens: number): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(Quota)
      .set({ tokenUsed: () => 'GREATEST(token_used - :reserved, 0)' })
      .where('id = :id', { id: quotaId })
      .setParameter('reserved', reservedTokens)
      .execute();
  }
}
