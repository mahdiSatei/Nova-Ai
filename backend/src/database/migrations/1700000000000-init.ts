import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the MVP. Six tables + indexes, written with
 * cross-DB SQL that works on both SQLite and PostgreSQL.
 */
export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

    // For PostgreSQL, create the uuid-ossp extension so UUID primary keys
    // get a DB-side default. SQLite uses TEXT primary keys filled by
    // TypeORM's JavaScript-side UUID generation.
    if (dbDriver === 'postgres') {
      await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);
    }

    const idCol = (table: string) =>
      dbDriver === 'postgres'
        ? `id UUID PRIMARY KEY DEFAULT uuid_generate_v4()`
        : `id TEXT PRIMARY KEY`;

    const fkId = (column: string) =>
      dbDriver === 'postgres' ? `${column} UUID NOT NULL` : `${column} TEXT NOT NULL`;

    const fkRefId = (column: string) =>
      dbDriver === 'postgres' ? `${column} UUID` : `${column} TEXT`;

    // users
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        ${idCol('id')},
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        last_selected_model_id TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));`,
    );

    // refresh_tokens
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        ${idCol('id')},
        ${fkId('user_id')},
        jti TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        revoked_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_jti ON refresh_tokens (jti);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);`,
    );

    // central_provider
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS central_provider (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        base_url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        last_validated_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // models
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS models (
        ${idCol('id')},
        display_name TEXT NOT NULL,
        actual_name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT true,
        is_default BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_models_display_name ON models (display_name);`,
    );

    // app_config
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        default_model_id ${dbDriver === 'postgres' ? 'UUID' : 'TEXT'},
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (default_model_id) REFERENCES models(id) ON DELETE SET NULL
      );
    `);

    // conversations
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        ${idCol('id')},
        ${fkId('user_id')},
        ${fkId('model_id')},
        title TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (model_id) REFERENCES models(id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_conv_user_updated ON conversations (user_id, updated_at);`,
    );

    // messages
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS messages (
        ${idCol('id')},
        ${fkId('conversation_id')},
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages (conversation_id, created_at);`,
    );

    // Seed the AppConfig singleton row so PUT can update it.
    // Use driver-specific syntax: INSERT OR IGNORE (SQLite) vs ON CONFLICT DO NOTHING (Postgres).
    if (dbDriver === 'postgres') {
      await queryRunner.query(
        `INSERT INTO app_config (id, default_model_id) VALUES ('singleton', NULL) ON CONFLICT (id) DO NOTHING;`,
      );
    } else {
      await queryRunner.query(
        `INSERT OR IGNORE INTO app_config (id, default_model_id) VALUES ('singleton', NULL);`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS messages;`);
    await queryRunner.query(`DROP TABLE IF EXISTS conversations;`);
    await queryRunner.query(`DROP TABLE IF EXISTS app_config;`);
    await queryRunner.query(`DROP TABLE IF EXISTS models;`);
    await queryRunner.query(`DROP TABLE IF EXISTS central_provider;`);
    await queryRunner.query(`DROP TABLE IF EXISTS refresh_tokens;`);
    await queryRunner.query(`DROP TABLE IF EXISTS users;`);
  }
}
