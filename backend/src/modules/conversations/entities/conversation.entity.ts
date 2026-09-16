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
import { User } from '../../users/entities/user.entity';
import { Model } from '../../models/entities/model.entity';
import { Message } from './message.entity';

@Entity({ name: 'conversations' })
@Index('idx_conv_user_updated', ['userId', 'updatedAt'])
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @ManyToOne(() => User, (u) => u.conversations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'model_id', type: 'text' })
  modelId!: string;

  @ManyToOne(() => Model, (m) => m.conversations)
  @JoinColumn({ name: 'model_id' })
  model!: Model;

  @Column({ type: 'text', nullable: true })
  title!: string | null;

  @Column({ type: 'boolean', default: false })
  pinned!: boolean;

  @CreateDateColumn({ name: 'created_at', type: Date })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: Date })
  updatedAt!: Date;

  @OneToMany(() => Message, (m) => m.conversation, { cascade: true })
  messages!: Message[];
}
