import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Provider } from '../../provider/entities/provider.entity';
import type { ModelVisibility } from '../model-visibility';
import type { StoredReasoningConfig } from '../../reasoning/reasoning.types';

@Entity({ name: 'models' })
@Index('uq_models_display_name', ['displayName'], { unique: true })
export class Model {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'actual_name', type: 'text' })
  actualName!: string;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @ManyToOne(() => Provider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'provider_id' })
  @Index('idx_models_provider_id')
  provider!: Provider;

  /**
   * Who may use this model. `public` (the default) keeps every pre-existing
   * model visible to the same audience as before phase 3.
   */
  @Column({ type: 'text', default: 'public' })
  visibility!: ModelVisibility;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /**
   * Model to use when this model's provider fails (spec 006). Nullable;
   * one hop only, so the fallback's own fallback is never followed.
   */
  @Column({ name: 'fallback_model_id', type: 'text', nullable: true })
  fallbackModelId!: string | null;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  /**
   * Reasoning capability configuration (Phase 8). One JSONB snapshot holds both
   * the automatically discovered capability and the admin's manual override, so
   * re-running discovery never destroys what an admin typed.
   */
  @Column({ name: 'reasoning_config', type: 'jsonb', default: () => `'{}'::jsonb` })
  reasoningConfig!: StoredReasoningConfig;

  /** Cost per 1,000 input tokens (USD). Zero means free or unpriced. */
  @Column({ name: 'input_price_per_1k', type: 'decimal', precision: 10, scale: 6, default: 0 })
  inputPricePer1k!: number;

  /** Cost per 1,000 output tokens (USD). Zero means free or unpriced. */
  @Column({ name: 'output_price_per_1k', type: 'decimal', precision: 10, scale: 6, default: 0 })
  outputPricePer1k!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => Conversation, (c) => c.model)
  conversations!: Conversation[];
}
