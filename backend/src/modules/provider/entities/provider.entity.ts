import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProviderApiKey } from './provider-api-key.entity';

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

  /**
   * Legacy: primary API key. Kept for backward compatibility.
   * New installations should use the provider_api_keys table.
   */
  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @Column({ name: 'last_validated_at', type: 'timestamp', nullable: true })
  lastValidatedAt!: Date | null;

  /** Multiple API keys for this provider. */
  @OneToMany(() => ProviderApiKey, (k) => k.provider)
  apiKeys!: ProviderApiKey[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
