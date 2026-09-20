import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, AuditAction } from './entities/audit-log.entity';

/** Sentinel actor ID for system-initiated events (e.g. cron, webhook). */
export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

export type AuditResult = 'success' | 'failure' | 'system';

export interface AuditEvent {
  actorId: string;
  actorEmail?: string;
  action: AuditAction;
  targetType: string;
  targetId?: string;
  result?: AuditResult;
  metadata?: Record<string, unknown>;
}

export interface AuditQueryFilters {
  action?: AuditAction;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Append-only audit log service.
 *
 * `log()` never throws — audit failures are logged and swallowed so they
 * never break the calling flow. This is a deliberate design decision:
 * audit is important but must not block business operations.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /** Append an audit event. Never throws. */
  async log(event: AuditEvent): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          actorId: event.actorId,
          actorEmail: event.actorEmail ?? null,
          action: event.action,
          targetType: event.targetType,
          targetId: event.targetId ?? null,
          // Keep the result meaningful even when callers omit it. Older
          // call sites historically relied on the column default, which made
          // `payment_failed` appear successful in the admin report.
          result: event.result ?? this.defaultResultFor(event),
          metadata: event.metadata ?? {},
        }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to write audit log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Query audit logs with filters. Admin-only. */
  async query(
    filters: AuditQueryFilters,
  ): Promise<{ items: AuditLog[]; total: number }> {
    const qb = this.repo.createQueryBuilder('audit');

    if (filters.action) {
      qb.andWhere('audit.action = :action', { action: filters.action });
    }
    if (filters.actorId) {
      qb.andWhere('audit.actor_id = :actorId', { actorId: filters.actorId });
    }
    if (filters.targetType) {
      qb.andWhere('audit.target_type = :targetType', {
        targetType: filters.targetType,
      });
    }
    if (filters.targetId) {
      qb.andWhere('audit.target_id = :targetId', { targetId: filters.targetId });
    }
    if (filters.from) {
      qb.andWhere('audit.created_at >= :from', { from: filters.from });
    }
    if (filters.to) {
      qb.andWhere('audit.created_at <= :to', { to: filters.to });
    }

    const total = await qb.getCount();

    const limit = Math.min(filters.limit ?? 50, 100);
    const offset = filters.offset ?? 0;
    const items = await qb
      .orderBy('audit.created_at', 'DESC')
      .skip(offset)
      .take(limit)
      .getMany();

    return {
      // Normalize legacy rows too: records written before result inference was
      // added may still contain the database default `success`.
      items: items.map((item) => ({
        ...item,
        result: this.defaultResultFor({
          actorId: item.actorId,
          action: item.action,
          result: item.result === 'success' ? undefined : (item.result as AuditResult),
        }),
      })),
      total,
    };
  }

  private defaultResultFor(event: Pick<AuditEvent, 'actorId' | 'action' | 'result'>): AuditResult {
    if (event.result) return event.result;
    if (event.actorId === SYSTEM_ACTOR_ID) return 'system';
    if (event.action.endsWith('_failed')) return 'failure';
    return 'success';
  }
}
