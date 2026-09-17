import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an optional `username` to users (sidebar/profile identity +
 * username-or-email login). Nullable so legacy accounts keep working
 * via email; unique case-insensitively via LOWER(username) index,
 * mirroring the email index from the init migration.
 */
export class AddUserUsername1700000002000 implements MigrationInterface {
  name = 'AddUserUsername1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN username TEXT;`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username_lower ON users (LOWER(username));`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_users_username_lower;`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN username;`);
  }
}
