import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

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

  @Column({ name: 'last_validated_at', type: 'datetime', nullable: true })
  lastValidatedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
