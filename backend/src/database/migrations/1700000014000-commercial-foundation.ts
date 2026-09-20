import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 5 (commercial foundation) — one migration for every schema change.
 *
 *   1. Model prices move from "USD per 1k tokens" to "Toman per 1M tokens".
 *   2. The `commercial` model visibility is retired (credit wallet replaces
 *      access tiers); existing commercial rows become `public`.
 *   3. `users.access_tier` is dropped.
 *   4. `usage_records` gains the commercial representation (reasoning tokens,
 *      charged cost in Toman, charged credits) while keeping the legacy
 *      `estimated_cost` column for historical rows.
 *   5. A `wallets` table holds each user's prepaid credit balance.
 *   6. The `quotas` / `quota_rules` tables are dropped — token quotas are no
 *      longer the entitlement mechanism.
 *
 * `down()` restores columns but cannot recreate the discarded quota rows, which
 * is called out explicitly rather than silently pretending to be lossless.
 */
export class CommercialFoundation1700000014000 implements MigrationInterface {
  name = 'CommercialFoundation1700000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Model pricing: USD/1k -> Toman/1M.
    await queryRunner.query(
      `ALTER TABLE models RENAME COLUMN input_price_per_1k TO input_price_per_1m`,
    );
    await queryRunner.query(
      `ALTER TABLE models RENAME COLUMN output_price_per_1k TO output_price_per_1m`,
    );
    await queryRunner.query(
      `ALTER TABLE models ALTER COLUMN input_price_per_1m TYPE DECIMAL(10,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE models ALTER COLUMN output_price_per_1m TYPE DECIMAL(10,4)`,
    );

    // 2. Retire the `commercial` visibility — its audience is now decided by
    //    the credit wallet, not by an access tier.
    await queryRunner.query(`UPDATE models SET visibility = 'public' WHERE visibility = 'commercial'`);

    // 3. Remove the user access tier.
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS access_tier`);

    // 4. Usage records gain the commercial fields. `estimated_cost` is kept for
    //    historical rows; new rows populate `charged_cost`/`charged_credits`.
    await queryRunner.query(
      `ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS reasoning_tokens INT NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS charged_cost DECIMAL(14,4) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS charged_credits DECIMAL(14,4) NOT NULL DEFAULT 0`,
    );

    // 5. Prepaid credit wallet, one per user.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        credit_balance DECIMAL(14,4) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    // 6. Drop the quota tables (the UNIQUE constraint above provides the
    //    wallet lookup index, so no separate index is created).
    await queryRunner.query(`DROP TABLE IF EXISTS quotas`);
    await queryRunner.query(`DROP TABLE IF EXISTS quota_rules`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS access_tier TEXT NOT NULL DEFAULT 'free'`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS wallets`);
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN IF EXISTS charged_credits`);
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN IF EXISTS charged_cost`);
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN IF EXISTS reasoning_tokens`);

    await queryRunner.query(`ALTER TABLE models ALTER COLUMN output_price_per_1m TYPE DECIMAL(10,6)`);
    await queryRunner.query(`ALTER TABLE models ALTER COLUMN input_price_per_1m TYPE DECIMAL(10,6)`);
    await queryRunner.query(
      `ALTER TABLE models RENAME COLUMN output_price_per_1m TO output_price_per_1k`,
    );
    await queryRunner.query(
      `ALTER TABLE models RENAME COLUMN input_price_per_1m TO input_price_per_1k`,
    );

    // NOTE: the dropped `quotas` / `quota_rules` tables and their rows are not
    // recreated here — the legacy data is intentionally discarded.
  }
}
