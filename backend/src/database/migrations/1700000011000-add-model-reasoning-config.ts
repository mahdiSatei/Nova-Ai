import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddModelReasoningConfig1700000011000 implements MigrationInterface {
  name = 'AddModelReasoningConfig1700000011000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE models
      ADD COLUMN reasoning_config JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE models DROP COLUMN reasoning_config`);
  }
}
