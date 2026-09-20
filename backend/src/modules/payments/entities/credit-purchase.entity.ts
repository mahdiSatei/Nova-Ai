import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreditPurchaseStatus } from '../payment-status';

/**
 * The user's intent to buy N Credits for a known price (Phase 2).
 *
 * The price is snapshotted onto the row (`pricePerCreditToman`) rather than
 * being looked up at verification time: a later change to `CREDIT_PRICE_TOMAN`
 * must not retroactively change what an in-flight purchase costs.
 */
@Entity('credit_purchases')
@Index('idx_credit_purchases_user_created', ['userId', 'createdAt'])
@Index('idx_credit_purchases_status', ['status'])
export class CreditPurchase {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Whole Credits only: Credits are sold in units, never fractions. */
  @Column({ name: 'credits', type: 'int' })
  credits!: number;

  @Column({ name: 'price_per_credit_toman', type: 'int' })
  pricePerCreditToman!: number;

  @Column({ name: 'amount_toman', type: 'int' })
  amountToman!: number;

  @Column({ name: 'currency', type: 'varchar', length: 8, default: 'IRT' })
  currency!: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'PENDING' })
  status!: CreditPurchaseStatus;

  /** Set once the payment attempt row exists; null while the provider request is in flight. */
  @Column({ name: 'payment_id', type: 'uuid', nullable: true })
  paymentId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;
}
