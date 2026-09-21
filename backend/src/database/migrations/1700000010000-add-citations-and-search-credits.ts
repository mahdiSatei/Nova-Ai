import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCitationsAndSearchCredits1700000010000 implements MigrationInterface {
  name = 'AddCitationsAndSearchCredits1700000010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE messages
      ADD COLUMN citations JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE usage_records ADD COLUMN search_credits INT NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE usage_records DROP COLUMN search_credits`);
    await queryRunner.query(`ALTER TABLE messages DROP COLUMN citations`);
  }
}
