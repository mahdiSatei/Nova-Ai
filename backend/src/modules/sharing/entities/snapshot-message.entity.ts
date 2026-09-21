import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ConversationSnapshot } from './conversation-snapshot.entity';

/**
 * A frozen copy of one message inside a conversation snapshot.
 *
 * These rows are created once and never updated. No foreign keys point back
 * to the live `messages` table — the snapshot is fully self-contained.
 */
@Entity({ name: 'snapshot_messages' })
@Index('idx_snap_msg_snapshot_created', ['snapshotId', 'createdAt'])
export class SnapshotMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId!: string;

  @ManyToOne(() => ConversationSnapshot, (s) => s.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'snapshot_id' })
  snapshot!: ConversationSnapshot;

  @Column({ type: 'text' })
  role!: 'user' | 'assistant';

  @Column({ type: 'text' })
  content!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  /** Citations snapshot (JSONB array, empty for user messages). */
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  citations!: unknown[];

  /** Reasoning summary if the message had one. */
  @Column({ name: 'reasoning_summary', type: 'text', nullable: true })
  reasoningSummary!: string | null;

  /** File attachment info snapshot (denormalized, no FK to live files table). */
  @Column({ name: 'file_snapshot', type: 'jsonb', nullable: true })
  fileSnapshot!: { id: string; originalName: string; mimeType: string; size: number } | null;
}
