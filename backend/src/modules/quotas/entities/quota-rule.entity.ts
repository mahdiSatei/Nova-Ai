import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'quota_rules' })
export class QuotaRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  tier!: string;

  @Column({ name: 'token_limit', type: 'bigint' })
  tokenLimit!: number;

  @Column({ type: 'text' })
  label!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
