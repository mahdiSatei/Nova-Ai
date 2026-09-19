import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderApiKeys1700000013000 implements MigrationInterface {
  name = 'AddProviderApiKeys1700000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create provider_api_keys table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS provider_api_keys (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        provider_id TEXT NOT NULL,
        label TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_validated_at TIMESTAMP,
        failure_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE,
        UNIQUE (provider_id, label)
      );
    `);

    // Add index on provider_id
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_provider_api_keys_provider_id 
      ON provider_api_keys(provider_id);
    `);

    // Migrate existing API keys from providers table to provider_api_keys
    // Only if there are providers with API keys
    await queryRunner.query(`
      INSERT INTO provider_api_keys (provider_id, label, api_key_encrypted, is_active, last_validated_at, created_at, updated_at)
      SELECT id, 'Default', api_key_encrypted, is_active, last_validated_at, created_at, updated_at
      FROM providers
      WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted != ''
      ON CONFLICT (provider_id, label) DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_provider_api_keys_provider_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS provider_api_keys;`);
  }
}
