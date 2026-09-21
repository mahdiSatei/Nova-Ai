import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageReasoning1700000012000 implements MigrationInterface {
  name = 'AddMessageReasoning1700000012000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN reasoning_enabled BOOLEAN NOT NULL DEFAULT false,
      ADD COLUMN reasoning_summary TEXT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
      DROP COLUMN reasoning_summary,
      DROP COLUMN reasoning_enabled
    `);
  }
}
