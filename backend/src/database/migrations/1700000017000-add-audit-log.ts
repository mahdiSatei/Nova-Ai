import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLog1700000017000 implements MigrationInterface {
  name = 'AddAuditLog1700000017000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE audit_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id UUID NOT NULL,
        actor_email TEXT,
        action VARCHAR(48) NOT NULL,
        target_type VARCHAR(32) NOT NULL,
        target_id UUID,
        result VARCHAR(16) NOT NULL DEFAULT 'success',
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_audit_action ON audit_log (action);
      CREATE INDEX idx_audit_actor ON audit_log (actor_id);
      CREATE INDEX idx_audit_target ON audit_log (target_type, target_id);
      CREATE INDEX idx_audit_created ON audit_log (created_at);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS audit_log;');
  }
}
