import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditAction =
  | 'payment_created'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'credit_granted'
  | 'credit_deducted'
  | 'model_pricing_changed'
  | 'model_access_changed'
  | 'admin_access';

/**
 * Append-only audit log for sensitive operations.
 *
 * Rows are created once and never updated or deleted by application code.
 * The table has no UPDATE or DELETE policies — the only way to modify
 * records is through direct database administration.
 */
@Entity({ name: 'audit_log' })
@Index('idx_audit_action', ['action'])
@Index('idx_audit_actor', ['actorId'])
@Index('idx_audit_target', ['targetType', 'targetId'])
@Index('idx_audit_created', ['createdAt'])
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Who performed the action. System-initiated actions use a sentinel UUID. */
  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  /** Email or identifier for display (denormalized for convenience). */
  @Column({ name: 'actor_email', type: 'text', nullable: true })
  actorEmail!: string | null;

  @Column({ type: 'varchar', length: 48 })
  action!: AuditAction;

  /** What was affected: 'payment', 'wallet', 'model', 'config', etc. */
  @Column({ name: 'target_type', type: 'varchar', length: 32 })
  targetType!: string;

  /** UUID of the affected entity, or null for system-level events. */
  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId!: string | null;

  /** 'success' | 'failure' | 'system' */
  @Column({ type: 'varchar', length: 16, default: 'success' })
  result!: string;

  /** Arbitrary metadata: amounts, old/new values, error codes, etc. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
