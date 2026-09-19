import { join } from 'path';

/**
 * Typed configuration tree.
 *
 * All values are loaded by `@nestjs/config` from the environment (with a
 * `.env` fallback for local dev). Validation is performed separately by
 * `env.validation.ts` via `class-validator`.
 *
 * NEVER read `process.env` directly outside this module. Pull values
 * via `configService.get(...)` from injected `ConfigService`.
 */

export interface AppConfig {
  port: number;
  nodeEnv: 'development' | 'test' | 'production';
  jwt: {
    secret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };
  db: {
    driver: 'sqlite' | 'postgres';
    sqliteFile: string;
    postgresUrl: string;
    postgres: {
      host: string;
      port: number;
      user: string;
      password: string;
      db: string;
    };
  };
  log: {
    level: string;
    dir: string;
  };
  provider: {
    encryptionKeyBase64: string;
  };
  storage: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    accessKey: string;
    secretKey: string;
    bucket: string;
    presignExpirySec: number;
  };
  redis: {
    host: string;
    port: number;
  };
}

export default (): AppConfig => ({
  port: Number(process.env.PORT ?? 3000),
  nodeEnv: (process.env.NODE_ENV as AppConfig['nodeEnv']) ?? 'development',
  jwt: {
    secret: process.env.JWT_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  db: {
    driver: (process.env.DB_DRIVER as AppConfig['db']['driver']) ?? 'sqlite',
    sqliteFile: process.env.SQLITE_FILE ?? './data/app.sqlite',
    postgresUrl: process.env.POSTGRES_URL ?? '',
    postgres: {
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      user: process.env.POSTGRES_USER ?? 'postgres',
      password: process.env.POSTGRES_PASSWORD ?? '',
      db: process.env.POSTGRES_DB ?? 'chatbot_db',
    },
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    dir: process.env.LOG_DIR ?? join(__dirname, '..', '..', 'logs'),
  },
  provider: {
    encryptionKeyBase64: process.env.PROVIDER_ENCRYPTION_KEY ?? '',
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT ?? 'localhost',
    port: Number(process.env.STORAGE_PORT ?? 9000),
    useSSL: (process.env.STORAGE_USE_SSL ?? 'false') === 'true',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.STORAGE_SECRET_KEY ?? 'minioadminpassword',
    bucket: process.env.STORAGE_BUCKET ?? 'chat-files',
    presignExpirySec: Number(process.env.STORAGE_PRESIGN_EXPIRY_SEC ?? 604800),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: Number(process.env.REDIS_PORT ?? 6379),
  },
});
