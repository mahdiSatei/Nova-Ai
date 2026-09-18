import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsageRecordsAndModelPricing1700000007000 implements MigrationInterface {
  name = 'AddUsageRecordsAndModelPricing1700000007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE usage_records (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
        model_id UUID NOT NULL REFERENCES models(id) ON DELETE RESTRICT,
        provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
        prompt_tokens INT NOT NULL DEFAULT 0,
        completion_tokens INT NOT NULL DEFAULT 0,
        total_tokens INT NOT NULL DEFAULT 0,
        estimated_cost DECIMAL(12,8) NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
      )
    `);

    await queryRunner.query(`CREATE INDEX idx_usage_user_created ON usage_records(user_id, created_at)`);
    await queryRunner.query(`CREATE INDEX idx_usage_model_created ON usage_records(model_id, created_at)`);
    await queryRunner.query(`CREATE INDEX idx_usage_provider_created ON usage_records(provider_id, created_at)`);
    await queryRunner.query(`CREATE INDEX idx_usage_conversation ON usage_records(conversation_id)`);
    await queryRunner.query(`CREATE UNIQUE INDEX idx_usage_message ON usage_records(message_id) WHERE message_id IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE models ADD COLUMN input_price_per_1k DECIMAL(10,6) NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE models ADD COLUMN output_price_per_1k DECIMAL(10,6) NOT NULL DEFAULT 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE models DROP COLUMN output_price_per_1k`);
    await queryRunner.query(`ALTER TABLE models DROP COLUMN input_price_per_1k`);
    await queryRunner.query(`DROP TABLE usage_records`);
  }
}
