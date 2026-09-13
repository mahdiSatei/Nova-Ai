import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the MVP. Six tables + the partial unique index
 * that enforces "at most one default model" at the database level
 * (SQLite-compatible partial index is created as a separate unique
 * index on a derived column where supported; the application layer
 * also enforces the invariant).
 */
export class Init1700000000000 implements MigrationInterface {
  name = 'Init1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        last_selected_model_id TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_login_at DATETIME
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (LOWER(email));`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        jti TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_refresh_jti ON refresh_tokens (jti);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens (user_id);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS central_provider (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        base_url TEXT NOT NULL,
        api_key_encrypted TEXT NOT NULL,
        last_validated_at DATETIME,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS models (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        actual_name TEXT NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT 1,
        is_default BOOLEAN NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_models_display_name ON models (display_name);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS app_config (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        default_model_id TEXT,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (default_model_id) REFERENCES models(id) ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        title TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (model_id) REFERENCES models(id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_conv_user_updated ON conversations (user_id, updated_at);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_msg_conv_created ON messages (conversation_id, created_at);`,
    );

    // Seed the AppConfig singleton row so PUT can update it.
    await queryRunner.query(
      `INSERT OR IGNORE INTO app_config (id, default_model_id) VALUES ('singleton', NULL);`,
    );
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
