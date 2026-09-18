import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 3 (model access control).
 *
 * Both columns are added with a default so every pre-existing row keeps the
 * audience it had before this migration: models stay `public`, users stay
 * `free`. The defaults are intentionally kept in the schema (unlike the
 * provider FK migration) because `public`/`free` are the correct floor values
 * for rows inserted outside the HTTP API (seeds, fixtures, direct SQL).
 */
export class AddModelVisibilityAndUserAccessTier1700000006000 implements MigrationInterface {
  name = 'AddModelVisibilityAndUserAccessTier1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE models ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`,
    );
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN access_tier TEXT NOT NULL DEFAULT 'free'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN access_tier`);
    await queryRunner.query(`ALTER TABLE models DROP COLUMN visibility`);
  }
}
