import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Message } from '../../conversations/entities/message.entity';
import { Model } from '../../models/entities/model.entity';
import { Provider } from '../../provider/entities/provider.entity';

@Entity({ name: 'usage_records' })
@Index('idx_usage_user_created', ['userId', 'createdAt'])
@Index('idx_usage_model_created', ['modelId', 'createdAt'])
@Index('idx_usage_provider_created', ['providerId', 'createdAt'])
@Index('idx_usage_conversation', ['conversationId'])
@Index('idx_usage_message', ['messageId'], { unique: true })
export class UsageRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'conversation_id', type: 'text' })
  conversationId!: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  /** Nullable until streaming completes — set when the provider supplies usage. */
  @Column({ name: 'message_id', type: 'text', nullable: true })
  messageId!: string | null;

  @ManyToOne(() => Message, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'message_id' })
  message!: Message | null;

  @Column({ name: 'model_id', type: 'text' })
  modelId!: string;

  @ManyToOne(() => Model, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'model_id' })
  model!: Model;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @ManyToOne(() => Provider, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'provider_id' })
  provider!: Provider;

  @Column({ name: 'prompt_tokens', type: 'int', default: 0 })
  promptTokens!: number;

  @Column({ name: 'completion_tokens', type: 'int', default: 0 })
  completionTokens!: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens!: number;

  /** Estimated cost in USD. Calculated from model pricing after streaming. */
  @Column({ name: 'estimated_cost', type: 'decimal', precision: 12, scale: 8, default: 0 })
  estimatedCost!: number;

  @Column({ type: 'int', default: 1 })
  attempts!: number;

  @Column({ type: 'text', default: 'pending' })
  status!: 'pending' | 'completed' | 'failed';

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  /** Set when the provider stream completes or fails. */
  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt!: Date | null;
}
