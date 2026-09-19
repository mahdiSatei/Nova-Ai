import { plainToInstance, Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  validateSync,
} from 'class-validator';

export class EnvironmentVariables {
  @IsEnum(['development', 'test', 'production'])
  @IsOptional()
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  PORT = 3000;

  @IsString()
  JWT_SECRET = '';

  @IsString()
  JWT_REFRESH_SECRET = '';

  @IsString()
  @IsOptional()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  @IsOptional()
  JWT_REFRESH_TTL = '7d';

  @IsString()
  @IsOptional()
  POSTGRES_URL = '';

  @IsString()
  @IsOptional()
  POSTGRES_HOST = 'localhost';

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  POSTGRES_PORT = 5432;

  @IsString()
  @IsOptional()
  POSTGRES_USER = 'postgres';

  @IsString()
  @IsOptional()
  POSTGRES_PASSWORD = '';

  @IsString()
  @IsOptional()
  POSTGRES_DB = 'chatbot_db';

  @IsString()
  @IsOptional()
  LOG_LEVEL = 'info';

  @IsString()
  @IsOptional()
  LOG_DIR = './logs';

  /** Base64-encoded 32-byte key for AES-256-GCM encryption of the provider API key. */
  @IsString()
  PROVIDER_ENCRYPTION_KEY = '';

  /** Serpex web-search credential. Optional so the app boots when Web Search is disabled. */
  @IsString()
  @IsOptional()
  SERPEX_API_KEY = '';

  @IsUrl({ require_tld: false })
  @IsString()
  @IsOptional()
  SERPEX_API_URL = 'https://api.serpex.dev';

  /** MinIO / S3-compatible object storage. */
  @IsString()
  @IsOptional()
  STORAGE_ENDPOINT = 'localhost';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  STORAGE_PORT = 9000;

  @IsString()
  @IsOptional()
  STORAGE_USE_SSL = 'false';

  @IsString()
  @IsOptional()
  STORAGE_ACCESS_KEY = 'minioadmin';

  @IsString()
  @IsOptional()
  STORAGE_SECRET_KEY = 'minioadminpassword';

  @IsString()
  @IsOptional()
  STORAGE_BUCKET = 'chat-files';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  STORAGE_PRESIGN_EXPIRY_SEC = 604800;

  /** Optional; only required for the admin seed script. */
  @IsString()
  @IsOptional()
  SEED_ADMIN_EMAIL?: string;

  @IsString()
  @IsOptional()
  SEED_ADMIN_PASSWORD?: string;

  @IsString()
  @IsOptional()
  REDIS_HOST = 'localhost';

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @IsOptional()
  REDIS_PORT = 6379;
}

/**
 * Validate raw env against `EnvironmentVariables`. Throws if anything
 * required is missing or invalid. Called by `ConfigModule.forRoot(...)`
 * validation hook.
 */
export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const formatted = errors
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n  ');
    throw new Error(`Environment validation failed:\n  ${formatted}`);
  }
  return validated;
}