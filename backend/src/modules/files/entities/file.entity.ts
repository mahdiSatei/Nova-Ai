import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum FileStatus {
  UPLOADED = 'UPLOADED',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  FAILED = 'FAILED',
}

@Entity({ name: 'files' })
export class FileRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'original_name', type: 'text' })
  originalName!: string;

  @Column({ name: 'mime_type', type: 'text' })
  mimeType!: string;

  /** Owning user; stamped at upload from the auth context. */
  @Column({ name: 'user_id', type: 'text' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'integer' })
  size!: number;

  @Column({ name: 'file_key', type: 'text' })
  fileKey!: string;

  @Column({ type: 'text' })
  url!: string;

  @Column({ type: 'text', default: FileStatus.UPLOADED })
  status!: FileStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'extracted_text', type: 'text', nullable: true })
  extractedText!: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage!: string | null;
}
