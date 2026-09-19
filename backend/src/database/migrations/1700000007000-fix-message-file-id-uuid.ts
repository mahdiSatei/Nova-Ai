import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixMessageFileIdUuid1700000007000 implements MigrationInterface {
  name = 'FixMessageFileIdUuid1700000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';
    if (dbDriver === 'postgres') {
      await queryRunner.query(`ALTER TABLE messages DROP COLUMN IF EXISTS file_id;`);
      await queryRunner.query(`ALTER TABLE messages ADD COLUMN file_id UUID;`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';
    if (dbDriver === 'postgres') {
      await queryRunner.query(`ALTER TABLE messages DROP COLUMN IF EXISTS file_id;`);
      await queryRunner.query(`ALTER TABLE messages ADD COLUMN file_id TEXT;`);
    }
  }
}