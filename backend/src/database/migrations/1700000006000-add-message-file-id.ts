import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMessageFileId1700000006000 implements MigrationInterface {
  name = 'AddMessageFileId1700000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE messages ADD COLUMN file_id TEXT;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE messages DROP COLUMN file_id;`);
  }
}