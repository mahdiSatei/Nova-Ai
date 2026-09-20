import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Prepaid credit wallet (Phase 5). One row per user.
 *
 * The balance is a fixed-precision `decimal(14,4)` — enough for
 * 999,999,999.9999 Credits. Arithmetic happens in the service layer where the
 * value is converted to integer sub-credit units before any add/subtract, so a
 * financial operation never rides on a JS float.
 */
@Entity({ name: 'wallets' })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'text', unique: true })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  /** Balance in Credits with 4 decimal places (1 Credit = 10,000 sub-units). */
  @Column({ name: 'credit_balance', type: 'decimal', precision: 14, scale: 4, default: 0 })
  creditBalance!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
