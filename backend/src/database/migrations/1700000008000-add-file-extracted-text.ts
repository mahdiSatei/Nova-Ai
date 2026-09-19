import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileExtractedText1700000008000 implements MigrationInterface {
  name = 'AddFileExtractedText1700000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE files ADD COLUMN extracted_text TEXT;`);
    await queryRunner.query(`ALTER TABLE files ADD COLUMN error_message TEXT;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE files DROP COLUMN error_message;`);
    await queryRunner.query(`ALTER TABLE files DROP COLUMN extracted_text;`);
  }
}