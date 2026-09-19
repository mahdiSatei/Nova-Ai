import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `files` table backing chat file uploads (Phase 3).
 * Records object-storage metadata plus a processing lifecycle status.
 *
 * Follows the cross-DB id pattern from 1700000000000-init: on PostgreSQL
 * the UUID is filled by `uuid_generate_v4()` (TypeORM omits the id column
 * for `@PrimaryGeneratedColumn('uuid')`); on SQLite TypeORM generates it
 * client-side.
 */
export class CreateFiles1700000005000 implements MigrationInterface {
  name = 'CreateFiles1700000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

    if (dbDriver === 'postgres') {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    }
    const idCol =
      dbDriver === 'postgres'
        ? `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`
        : `id TEXT PRIMARY KEY`;

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS files (
        ${idCol},
        user_id TEXT NOT NULL DEFAULT '',
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        file_key TEXT NOT NULL,
        url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'UPLOADED',
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_files_user ON files (user_id);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_files_user;`);
    await queryRunner.query(`DROP TABLE IF EXISTS files;`);
  }
}
