import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuotasAndQuotaRules1700000008000 implements MigrationInterface {
  name = 'AddQuotasAndQuotaRules1700000008000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE quotas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_limit BIGINT NOT NULL,
        token_used BIGINT NOT NULL DEFAULT 0,
        last_reset_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX idx_quotas_user ON quotas(user_id)`);

    await queryRunner.query(`
      CREATE TABLE quota_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tier TEXT NOT NULL,
        token_limit BIGINT NOT NULL,
        label TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX idx_quota_rules_tier ON quota_rules(tier)`);

    // Seed default quota rules
    await queryRunner.query(`
      INSERT INTO quota_rules (tier, token_limit, label) VALUES
        ('free', 100000, 'Free tier — 100K tokens/month'),
        ('commercial', 1000000, 'Commercial tier — 1M tokens/month')
    ON CONFLICT (tier) DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE quota_rules`);
    await queryRunner.query(`DROP TABLE quotas`);
  }
}
