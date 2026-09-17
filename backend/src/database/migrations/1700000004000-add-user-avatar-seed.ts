import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds an optional `avatar_seed` to users. The identicon is generated
 * from avatar_seed when set, otherwise from the user id. Rotating the
 * seed changes the avatar deterministically without storing images.
 */
export class AddUserAvatarSeed1700000004000 implements MigrationInterface {
  name = 'AddUserAvatarSeed1700000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN avatar_seed TEXT;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN avatar_seed;`);
  }
}
