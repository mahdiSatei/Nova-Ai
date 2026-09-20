import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SnapshotMessage } from './snapshot-message.entity';

/**
 * An immutable snapshot of a conversation at the moment of sharing.
 *
 * Once created, neither this row nor its messages are ever updated or deleted
 * by application code. The snapshot is fully self-contained: it holds frozen
 * copies of all data it needs, with no foreign keys back to the live
 * conversations or messages tables.
 *
 * The `shareId` is the public-facing identifier exposed in the share URL.
 * It is a random UUID, deliberately never the real conversation ID.
 */
@Entity({ name: 'conversation_snapshots' })
@Index('idx_snapshot_share_id', ['shareId'], { unique: true })
@Index('idx_snapshot_owner', ['ownerId'])
export class ConversationSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Public-facing share identifier. Random UUID — never the real conversation id. */
  @Column({ name: 'share_id', type: 'uuid', unique: true })
  shareId!: string;

  /** The user who created this snapshot. Used only for creation-time ownership check. */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  /** Snapshot of conversation title at share time. */
  @Column({ type: 'text', nullable: true })
  title!: string | null;

  /** Snapshot of the model id used by the conversation. */
  @Column({ name: 'model_id', type: 'text' })
  modelId!: string;

  /** Snapshot of the model display name. */
  @Column({ name: 'model_display_name', type: 'text', nullable: true })
  modelDisplayName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @OneToMany(() => SnapshotMessage, (m) => m.snapshot, { cascade: true })
  messages!: SnapshotMessage[];
}
