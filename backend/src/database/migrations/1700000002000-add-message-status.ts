import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `status` column to the messages table and creates a composite
 * index on (conversation_id, status) for efficient streaming-message lookups.
 *
 * Cross-DB: uses conditional checks for both SQLite and PostgreSQL.
 */
export class AddMessageStatus1700000002000 implements MigrationInterface {
  name = 'AddMessageStatus1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

    if (dbDriver === 'postgres') {
      await queryRunner.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
      `);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const cols = await queryRunner.query(`PRAGMA table_info(messages)`) as { name: string }[];
      const hasStatus = cols.some((c: { name: string }) => c.name === 'status');
      if (!hasStatus) {
        await queryRunner.query(`
          ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
        `);
      }
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_msg_conv_status
      ON messages (conversation_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

    if (dbDriver === 'postgres') {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_msg_conv_status;`);
      await queryRunner.query(`ALTER TABLE messages DROP COLUMN IF EXISTS status;`);
    } else {
      await queryRunner.query(`CREATE TABLE messages_backup AS SELECT id, conversation_id, role, content, created_at FROM messages;`);
      await queryRunner.query(`DROP TABLE messages;`);
      await queryRunner.query(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
      `);
      await queryRunner.query(`INSERT INTO messages SELECT * FROM messages_backup;`);
      await queryRunner.query(`DROP TABLE messages_backup;`);
      await queryRunner.query(`DROP INDEX IF EXISTS idx_msg_conv_status;`);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_msg_conv_created
        ON messages (conversation_id, created_at);
      `);
    }
  }
}
