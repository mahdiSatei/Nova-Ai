import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Model } from '../../models/entities/model.entity';

/**
 * Singleton row holding the central provider's configuration. The
 * application layer refuses to create a second row; this entity uses a
 * fixed-string primary key so any second insert would conflict on PK
 * regardless.
 */
@Entity({ name: 'central_provider' })
export class CentralProvider {
  @PrimaryColumn({ type: 'text', default: 'singleton' })
  id!: 'singleton';

  @Column({ name: 'base_url', type: 'text' })
  baseUrl!: string;

  /** AES-256-GCM ciphertext JSON: { ciphertext, iv, authTag }. */
  @Column({ name: 'api_key_encrypted', type: 'text' })
  apiKeyEncrypted!: string;

  @Column({ name: 'last_validated_at', type: 'timestamp', nullable: true })
  lastValidatedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;
}
