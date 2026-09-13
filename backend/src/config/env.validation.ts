import { plainToInstance } from 'class-transformer';
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

  @IsEnum(['sqlite', 'postgres'])
  @IsOptional()
  DB_DRIVER: 'sqlite' | 'postgres' = 'sqlite';

  @IsString()
  @IsOptional()
  SQLITE_FILE = './data/app.sqlite';

  @IsString()
  @IsOptional()
  POSTGRES_URL = '';

  @IsString()
  @IsOptional()
  LOG_LEVEL = 'info';

  @IsString()
  @IsOptional()
  LOG_DIR = './logs';

  /** Base64-encoded 32-byte key for AES-256-GCM encryption of the provider API key. */
  @IsString()
  PROVIDER_ENCRYPTION_KEY = '';

  /** Optional; only required for the admin seed script. */
  @IsString()
  @IsOptional()
  SEED_ADMIN_EMAIL?: string;

  @IsString()
  @IsOptional()
  SEED_ADMIN_PASSWORD?: string;
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

// silence unused-import warning for `IsUrl` retained for future endpoint config
void IsUrl;
