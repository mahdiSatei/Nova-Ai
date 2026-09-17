import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ProviderType = 'openai-compatible';

@Entity({ name: 'providers' })
export class Provider {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ name: 'name', type: 'text', unique: true })
  name!: string;

  @Column({ name: 'type', type: 'text' })
  type!: ProviderType;

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  /** AES-256-GCM ciphertext JSON: { ciphertext, iv, authTag }. */
  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_validated_at', type: 'timestamp', nullable: true })
  lastValidatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
