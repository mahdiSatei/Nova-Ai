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
import { FileRecord } from '../../files/entities/file.entity';

@Entity({ name: 'messages' })
@Index('idx_msg_conv_created', ['conversationId', 'createdAt'])
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'conversation_id', type: 'text' })
  conversationId!: string;

  @ManyToOne(() => Conversation, (c) => c.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: Conversation;

  @Column({ name: 'file_id', type: 'text', nullable: true })
  fileId!: string | null;

  @ManyToOne(() => FileRecord, { nullable: true, eager: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'file_id' })
  file!: FileRecord | null;

  @Column({ type: 'text' })
  role!: 'user' | 'assistant';

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}