import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Model } from '../../models/entities/model.entity';

/**
 * Singleton row holding system-wide configuration. Currently exposes a
 * nullable reference to the current default model. New configuration
 * keys may be added as additional columns.
 */
@Entity({ name: 'app_config' })
export class AppConfig {
  @PrimaryColumn({ type: 'text', default: 'singleton' })
  id!: 'singleton';

  @Column({ name: 'default_model_id', type: 'text', nullable: true })
  defaultModelId!: string | null;

  @ManyToOne(() => Model)
  @JoinColumn({ name: 'default_model_id' })
  defaultModel!: Model | null;

  @UpdateDateColumn({ name: 'updated_at', type: Date })
  updatedAt!: Date;
}
