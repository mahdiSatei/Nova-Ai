import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';

@Entity({ name: 'models' })
@Index('uq_models_display_name', ['displayName'], { unique: true })
export class Model {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'display_name', type: 'text' })
  displayName!: string;

  @Column({ name: 'actual_name', type: 'text' })
  actualName!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'is_default', type: 'boolean', default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: 'created_at', type: Date })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: Date })
  updatedAt!: Date;

  @OneToMany(() => Conversation, (c) => c.model)
  conversations!: Conversation[];
}
