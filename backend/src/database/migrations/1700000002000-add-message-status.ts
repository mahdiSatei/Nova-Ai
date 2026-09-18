import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `status` column to the messages table and creates a composite
 * index on (conversation_id, status) for efficient streaming-message lookups.
 *
 */
export class AddMessageStatus1700000002000 implements MigrationInterface {
  name = 'AddMessageStatus1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_msg_conv_status
      ON messages (conversation_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_msg_conv_status;`);
    await queryRunner.query(`ALTER TABLE messages DROP COLUMN IF EXISTS status;`);
  }
}
