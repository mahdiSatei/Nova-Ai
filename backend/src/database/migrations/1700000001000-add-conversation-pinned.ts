import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `pinned` flag to conversations (sidebar pin/unpin feature).
 * Cross-DB SQL: valid on both SQLite (≥3.23 for TRUE/FALSE keywords,
 * ≥3.35 for DROP COLUMN) and PostgreSQL.
 */
export class AddConversationPinned1700000001000 implements MigrationInterface {
  name = 'AddConversationPinned1700000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations
      ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE conversations DROP COLUMN pinned;
    `);
  }
}
