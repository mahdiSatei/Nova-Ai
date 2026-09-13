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
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  email!: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash!: string;

  @Column({ type: 'text', default: 'user' })
  role!: 'user' | 'admin';

  @Column({ name: 'last_selected_model_id', type: 'text', nullable: true })
  lastSelectedModelId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt!: Date | null;

  @OneToMany(() => RefreshToken, (t) => t.user)
  refreshTokens!: RefreshToken[];

  @OneToMany(() => Conversation, (c) => c.user)
  conversations!: Conversation[];
}
