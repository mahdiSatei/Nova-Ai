import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an optional `display_name` to users (profile "name" shown next
 * to the avatar). Nullable; empty input is normalized to NULL by the
 * API layer, so the column is either NULL or a non-blank string.
 */
export class AddUserDisplayName1700000003000 implements MigrationInterface {
  name = 'AddUserDisplayName1700000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN display_name TEXT;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN display_name;`);
  }
}
