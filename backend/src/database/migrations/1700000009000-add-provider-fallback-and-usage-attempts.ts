import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProviderFallbackAndUsageAttempts1700000009000 implements MigrationInterface {
  name = 'AddProviderFallbackAndUsageAttempts1700000009000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Self-referential FK. ON DELETE SET NULL means deleting a model silently
    // drops it from other models' fallback slots rather than blocking the
    // delete or leaving a dangling reference.
    await queryRunner.query(`
      ALTER TABLE models
      ADD COLUMN fallback_model_id UUID REFERENCES models(id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE models
      ADD CONSTRAINT chk_models_fallback_not_self
      CHECK (fallback_model_id IS NULL OR fallback_model_id <> id)
    `);

    await queryRunner.query(`
      ALTER TABLE usage_records ADD COLUMN attempts INT NOT NULL DEFAULT 1
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN attempts`);
    await queryRunner.query(`ALTER TABLE models DROP CONSTRAINT chk_models_fallback_not_self`);
    await queryRunner.query(`ALTER TABLE models DROP COLUMN fallback_model_id`);
  }
}
