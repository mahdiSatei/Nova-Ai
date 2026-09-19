import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Provider } from './provider.entity';

@Entity({ name: 'provider_api_keys' })
@Index('uq_provider_api_keys_label', ['providerId', 'label'], { unique: true })
export class ProviderApiKey {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider_id', type: 'text' })
  providerId!: string;

  @ManyToOne(() => Provider, (p) => p.apiKeys, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'provider_id' })
  provider!: Provider;

  /** Human-readable label for this key (e.g., "Production", "Backup"). */
  @Column({ type: 'text' })
  label!: string;

  /** Encrypted API key. */
  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted!: string;

  /** Whether this key is currently active. */
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  /** When this key was last validated successfully. */
  @Column({ name: 'last_validated_at', type: 'timestamp', nullable: true })
  lastValidatedAt!: Date | null;

  /** Number of consecutive validation failures. Reset on success. */
  @Column({ name: 'failure_count', type: 'int', default: 0 })
  failureCount!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
