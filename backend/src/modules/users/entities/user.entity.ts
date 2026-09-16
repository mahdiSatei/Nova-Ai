import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { Conversation } from '../../conversations/entities/conversation.entity';

@Entity({ name: 'users' })
@Index('uq_users_email_lower', { synchronize: false })
@Index('uq_users_username_lower', { synchronize: false })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  /** Optional username (required for new signups). Stored lowercased. */
  @Column({ type: 'text', nullable: true })
  username!: string | null;

  /** Optional profile display name. Null or non-blank. */
  @Column({ name: 'display_name', type: 'text', nullable: true })
  displayName!: string | null;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text', default: 'user' })
  role!: 'user' | 'admin';

  @Column({ name: 'last_selected_model_id', type: 'text', nullable: true })
  lastSelectedModelId!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'last_login_at', nullable: true })
  lastLoginAt?: Date;

  @OneToMany(() => RefreshToken, (t) => t.user)
  refreshTokens!: RefreshToken[];

  @OneToMany(() => Conversation, (c) => c.user)
  conversations!: Conversation[];
}
