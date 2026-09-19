import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { MessageStatus } from '../conversations.types';
import type { CitationSource } from '../../web-search/web-search.types';

@Entity({ name: 'messages' })
@Index('idx_msg_conv_created', ['conversationId', 'createdAt'])
@Index('idx_msg_conv_status', ['conversationId', 'status'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'text' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ type: 'text' })
  role!: 'user' | 'assistant';

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'status', type: 'text', default: 'completed' })
  status!: MessageStatus;

  /** Web-search sources cited by this assistant message (empty for normal turns). */
  @Column({ name: 'citations', type: 'jsonb', default: () => "'[]'::jsonb" })
  citations!: CitationSource[];

  /** True when the user enabled reasoning for this turn. */
  @Column({ name: 'reasoning_enabled', type: 'boolean', default: false })
  reasoningEnabled!: boolean;

  /**
   * The provider's user-visible reasoning summary, when one was exposed.
   * Only ever written on successful completion — never chain-of-thought, never
   * internal reasoning tokens, never a summary for an interrupted generation.
   */
  @Column({ name: 'reasoning_summary', type: 'text', nullable: true })
  reasoningSummary!: string | null;
}
