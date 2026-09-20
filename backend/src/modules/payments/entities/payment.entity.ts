import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentStatus } from '../payment-status';

/**
 * One payment attempt at a provider for a `CreditPurchase` (Phase 2).
 *
 * `providerAmountRial` is a `bigint` column and therefore arrives from
 * PostgreSQL as a **string**. Callers must convert explicitly (see the
 * amount-tampering check in `PaymentsService.verifyAndFinalize`) — comparing it
 * with `Number` is how rounding bugs become security bugs.
 */
@Entity('payments')
@Index('idx_payments_user_created', ['userId', 'createdAt'])
@Index('idx_payments_status', ['status'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'credit_purchase_id', type: 'uuid' })
  creditPurchaseId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'provider', type: 'varchar', length: 32 })
  provider!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'PENDING' })
  status!: PaymentStatus;

  @Column({ name: 'amount_toman', type: 'int' })
  amountToman!: number;

  @Column({ name: 'provider_amount_rial', type: 'bigint', nullable: true })
  providerAmountRial!: string | null;

  @Column({ name: 'currency', type: 'varchar', length: 8, default: 'IRR' })
  currency!: string;

  /** Zibal's `trackId`. Unique so the public callback maps to exactly one payment. */
  @Column({ name: 'provider_track_id', type: 'varchar', length: 64, nullable: true, unique: true })
  providerTrackId!: string | null;

  @Column({ name: 'provider_reference', type: 'varchar', length: 128, nullable: true })
  providerReference!: string | null;

  /** Raw provider result code, kept as text for forensics. */
  @Column({ name: 'provider_status', type: 'varchar', length: 32, nullable: true })
  providerStatus!: string | null;

  @Column({ name: 'provider_raw_data', type: 'jsonb', nullable: true })
  providerRawData!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;
}
