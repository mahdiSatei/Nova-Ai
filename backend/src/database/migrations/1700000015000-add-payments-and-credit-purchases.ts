import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — credit purchase (Zibal) schema.
 *
 * Money rules: Toman is always `integer`; the rial amount exchanged with the
 * provider is `bigint`. Credits are whole numbers on a purchase because Credits
 * are sold in units.
 */
export class AddPaymentsAndCreditPurchases1700000015000 implements MigrationInterface {
  name = 'AddPaymentsAndCreditPurchases1700000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS credit_purchases (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        credits INTEGER NOT NULL,
        price_per_credit_toman INTEGER NOT NULL,
        amount_toman INTEGER NOT NULL,
        currency VARCHAR(8) NOT NULL DEFAULT 'IRT',
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        payment_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT chk_credit_purchases_credits_positive CHECK (credits > 0),
        CONSTRAINT chk_credit_purchases_amount_positive CHECK (amount_toman > 0),
        CONSTRAINT chk_credit_purchases_price_positive CHECK (price_per_credit_toman > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_credit_purchases_user_created ON credit_purchases(user_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_credit_purchases_status ON credit_purchases(status)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        credit_purchase_id UUID NOT NULL REFERENCES credit_purchases(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        amount_toman INTEGER NOT NULL,
        provider_amount_rial BIGINT,
        currency VARCHAR(8) NOT NULL DEFAULT 'IRR',
        provider_track_id VARCHAR(64),
        provider_reference VARCHAR(128),
        provider_status VARCHAR(32),
        provider_raw_data JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        paid_at TIMESTAMPTZ,
        CONSTRAINT chk_payments_amount_positive CHECK (amount_toman > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_user_created ON payments(user_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_track_id ON payments(provider_track_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)`,
    );
    // At most one live attempt per purchase. Defence in depth: today every
    // purchase creates exactly one attempt, but this stops a future "retry the
    // payment" endpoint from leaving two PENDING rows for one purchase.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_purchase_pending
         ON payments(credit_purchase_id) WHERE status = 'PENDING'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS payments`);
    await queryRunner.query(`DROP TABLE IF EXISTS credit_purchases`);
  }
}
