import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddConversationSnapshots1700000016000 implements MigrationInterface {
  name = 'AddConversationSnapshots1700000016000';

  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE conversation_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        share_id UUID NOT NULL UNIQUE,
        owner_id UUID NOT NULL,
        title TEXT,
        model_id TEXT NOT NULL,
        model_display_name TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_snapshot_share_id ON conversation_snapshots (share_id);
      CREATE INDEX idx_snapshot_owner ON conversation_snapshots (owner_id);

      CREATE TABLE snapshot_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        snapshot_id UUID NOT NULL REFERENCES conversation_snapshots(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        citations JSONB NOT NULL DEFAULT '[]'::jsonb,
        reasoning_summary TEXT,
        file_snapshot JSONB
      );
      CREATE INDEX idx_snap_msg_snapshot_created ON snapshot_messages (snapshot_id, created_at);
    `);
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query('DROP TABLE IF EXISTS snapshot_messages;');
    await qr.query('DROP TABLE IF EXISTS conversation_snapshots;');
  }
}
