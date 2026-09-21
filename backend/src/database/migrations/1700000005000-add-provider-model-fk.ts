import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderModelFk1700000005000 implements MigrationInterface {
  name = 'AddProviderModelFk1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create providers table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        base_url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        last_validated_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Migrate singleton central_provider row into providers table
    await queryRunner.query(`
      INSERT INTO providers (id, name, type, base_url, api_key_encrypted, is_active, last_validated_at, created_at, updated_at)
      SELECT 'central', 'Default Provider', 'openai-compatible', base_url, api_key_encrypted, true, last_validated_at, created_at, updated_at
      FROM central_provider WHERE id = 'singleton'
    `);

    // 3. Add provider_id column to models (non-null, default 'central' for backfill)
    await queryRunner.query(`ALTER TABLE models ADD COLUMN provider_id TEXT NOT NULL DEFAULT 'central';`);

    // 4. Ensure all rows point to a valid provider
    await queryRunner.query(`UPDATE models SET provider_id = 'central' WHERE provider_id IS NULL`);

    // 5. Remove the column default so future inserts must provide a value
    await queryRunner.query(`ALTER TABLE models ALTER COLUMN provider_id DROP DEFAULT;`);

    // 6. Add FK constraint (TypeORM createForeignKey has a bug with
    // string table names on PostgreSQL 0.3.x, so use raw SQL instead).
    await queryRunner.query(`
      ALTER TABLE models
        ADD CONSTRAINT fk_models_provider
        FOREIGN KEY (provider_id) REFERENCES providers(id)
        ON DELETE RESTRICT
    `);

    // 7. Add index on provider_id
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS idx_models_provider_id ON models (provider_id);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_models_provider_id;`);
    await queryRunner.dropForeignKey('models', 'fk_models_provider');
    await queryRunner.query(`ALTER TABLE models DROP COLUMN provider_id;`);
    await queryRunner.query(`DROP TABLE IF EXISTS providers;`);
  }
}
