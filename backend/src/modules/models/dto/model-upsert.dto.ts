import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body for POST and PATCH on `/v1/admin/models`.
 *
 * On POST every field except `enabled` is required; on PATCH every
 * field is optional (partial update). Class-validator runs in
 * `forbidNonWhitelisted` mode so unknown fields are rejected at the
 * boundary. `@IsOptional()` skips validation when the field is absent;
 * when present, the type-specific decorators still apply.
 */
export class ModelUpsertDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'displayName must not be empty' })
  @MaxLength(80, { message: 'displayName must be at most 80 characters' })
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'actualName must not be empty' })
  @MaxLength(200, { message: 'actualName must be at most 200 characters' })
  actualName?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
