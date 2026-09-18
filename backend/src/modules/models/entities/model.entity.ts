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

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => Conversation, (c) => c.model)
  conversations!: Conversation[];
}
