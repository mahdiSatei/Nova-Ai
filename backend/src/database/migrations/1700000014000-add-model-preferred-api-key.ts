import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModelPreferredApiKey1700000014000 implements MigrationInterface {
  name = 'AddModelPreferredApiKey1700000014000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE models
      ADD COLUMN preferred_api_key_id TEXT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE models
      DROP COLUMN preferred_api_key_id
    `);
  }
}
