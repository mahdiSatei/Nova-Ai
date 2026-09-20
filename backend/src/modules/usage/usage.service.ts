import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageRecord } from './entities/usage-record.entity';

export interface CreateUsageInput {
  userId: string;
  conversationId: string;
  modelId: string;
  providerId: string;
  /** Provider attempts made, including retries and fallbacks. Defaults to 1. */
  attempts?: number;
  /**
   * The assistant message this generation produces. With the unique index on
   * `usage_records.message_id`, two usage records for one generation are
   * structurally impossible (spec Phase 3 §3.9).
   */
  messageId?: string;
}

export interface FinalizeUsageInput {
  /** Provider-reported input (prompt) tokens. */
  inputTokens: number;
  /** Provider-reported output (completion) tokens, excluding reasoning. */
  outputTokens: number;
  /** Provider-reported total tokens. */
  totalTokens: number;
  /** Reasoning tokens, reported separately and billed at the output rate. */
  reasoningTokens?: number;
  /**
   * Cost charged for the request in Toman, precomputed by `UsagePricingService`.
   * Pricing deliberately does not live here: this service only persists what the
   * billing layer decided. Ignored (stored as 0) when `status` is `failed`.
   */
  chargedCost: number;
  /** Credits actually deducted for the request. Ignored when `status` is `failed`. */
  chargedCredits: number;
  status: 'completed' | 'failed';
  /** Web-search credits consumed during the request (Phase 7). */
  searchCredits?: number;
}

export interface AdminUsageQuery {
  userId?: string;
  modelId?: string;
  providerId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  limit: number;
  offset: number;
}

@Injectable()
export class UsageService {
  constructor(
    @InjectRepository(UsageRecord)
    private readonly repo: Repository<UsageRecord>,
  ) {}

  /**
   * Create a pending usage record once a provider stream has been established.
   * The model is passed explicitly because with fallback the serving model is
   * not known until establishment succeeds.
   */
  async create(input: CreateUsageInput): Promise<UsageRecord> {
    const record = this.repo.create({
      ...input,
      attempts: input.attempts ?? 1,
      status: 'pending',
    });
    return this.repo.save(record);
  }

  /**
   * Finalize a usage record exactly once.
   *
   * The `status: 'pending'` predicate rides inside the same UPDATE that applies
   * the final values, so two concurrent calls can never both report success —
   * the same exactly-once shape the payments module uses for
   * `UPDATE payments ... WHERE status = 'PENDING'`. Returns true only for the
   * call that actually transitioned the record; callers must treat `true` as
   * the permission to charge the wallet (spec Phase 3 §3.9).
   */
  async finalizeOnce(id: string, input: FinalizeUsageInput): Promise<boolean> {
    const charged = input.status === 'completed';

    const result = await this.repo.update(
      { id, status: 'pending' },
      {
        promptTokens: input.inputTokens,
        completionTokens: input.outputTokens,
        totalTokens: input.totalTokens,
        reasoningTokens: input.reasoningTokens ?? 0,
        chargedCost: charged ? input.chargedCost : 0,
        chargedCredits: charged ? input.chargedCredits : 0,
        status: input.status,
        searchCredits: input.searchCredits ?? 0,
        completedAt: new Date(),
      },
    );

    return (result.affected ?? 0) === 1;
  }

  /** Return the authenticated user's aggregate usage and recent requests. */
  async getUserSummary(userId: string) {
    const totals = await this.repo
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.prompt_tokens), 0)', 'inputTokens')
      .addSelect('COALESCE(SUM(u.completion_tokens), 0)', 'outputTokens')
      .addSelect('COALESCE(SUM(u.reasoning_tokens), 0)', 'reasoningTokens')
      .addSelect('COALESCE(SUM(u.total_tokens), 0)', 'totalTokens')
      .addSelect('COALESCE(SUM(u.charged_credits), 0)', 'chargedCredits')
      .addSelect('COUNT(*)', 'requestCount')
      .where('u.userId = :userId', { userId })
      .andWhere('u.status = :status', { status: 'completed' })
      .getRawOne<Record<string, string>>();

    const recent = await this.repo.find({
      where: { userId, status: 'completed' },
      relations: ['model'],
      order: { createdAt: 'DESC' },
      take: 10,
    });

    return {
      totals: {
        inputTokens: Number(totals?.inputTokens ?? 0),
        outputTokens: Number(totals?.outputTokens ?? 0),
        reasoningTokens: Number(totals?.reasoningTokens ?? 0),
        totalTokens: Number(totals?.totalTokens ?? 0),
        chargedCredits: Number(totals?.chargedCredits ?? 0),
        requestCount: Number(totals?.requestCount ?? 0),
      },
      recent: recent.map((record) => ({
        id: record.id,
        modelName: record.model?.displayName ?? null,
        inputTokens: record.promptTokens,
        outputTokens: record.completionTokens,
        reasoningTokens: record.reasoningTokens ?? 0,
        totalTokens: record.totalTokens,
        chargedCredits: Number(record.chargedCredits),
        createdAt: record.createdAt.toISOString(),
      })),
    };
  }

  /** List usage records for admin report with filters and pagination. */
  async listForAdmin(query: AdminUsageQuery) {
    const qb = this.repo
      .createQueryBuilder('u')
      .leftJoinAndSelect('u.model', 'model')
      .leftJoinAndSelect('u.provider', 'provider')
      .leftJoinAndSelect('u.user', 'user');

    if (query.userId) {
      qb.andWhere('u.userId = :userId', { userId: query.userId });
    }
    if (query.modelId) {
      qb.andWhere('u.modelId = :modelId', { modelId: query.modelId });
    }
    if (query.providerId) {
      qb.andWhere('u.providerId = :providerId', { providerId: query.providerId });
    }
    if (query.status) {
      qb.andWhere('u.status = :status', { status: query.status });
    }
    if (query.from) {
      qb.andWhere('u.createdAt >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('u.createdAt <= :to', { to: query.to });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip(query.offset)
      .take(query.limit);

    const [items, total] = await qb.getManyAndCount();

    // Aggregate totals for the filtered set (without pagination limits).
    // `totalCost` is now Toman (SUM of charged_cost); `estimated_cost` (legacy
    // USD) is intentionally not part of the report.
    const totalsQb = this.repo
      .createQueryBuilder('u')
      .select('COALESCE(SUM(u.total_tokens), 0)', 'totalTokens')
      .addSelect('COALESCE(SUM(u.charged_cost), 0)', 'totalCost')
      .addSelect('COALESCE(SUM(u.charged_credits), 0)', 'totalCredits')
      .addSelect('COUNT(*)', 'requestCount');

    if (query.userId) totalsQb.andWhere('u.userId = :userId', { userId: query.userId });
    if (query.modelId) totalsQb.andWhere('u.modelId = :modelId', { modelId: query.modelId });
    if (query.providerId) totalsQb.andWhere('u.providerId = :providerId', { providerId: query.providerId });
    if (query.status) totalsQb.andWhere('u.status = :status', { status: query.status });
    if (query.from) totalsQb.andWhere('u.createdAt >= :from', { from: query.from });
    if (query.to) totalsQb.andWhere('u.createdAt <= :to', { to: query.to });

    const totals = await totalsQb.getRawOne() as {
      totalTokens: string;
      totalCost: string;
      totalCredits: string;
      requestCount: string;
    } | null;

    return {
      items,
      total,
      totals: {
        totalTokens: Number(totals?.totalTokens ?? 0),
        totalCost: Number(totals?.totalCost ?? 0),
        totalCredits: Number(totals?.totalCredits ?? 0),
        requestCount: Number(totals?.requestCount ?? 0),
      },
    };
  }
}
