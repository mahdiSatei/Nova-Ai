import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PROVIDER_ID_PATTERN } from '../../provider/dto/create-provider.dto';
import { MODEL_VISIBILITIES, ModelVisibility } from '../model-visibility';
import type { ReasoningConfigMode, ReasoningOutput } from '../../reasoning/reasoning.types';

export const REASONING_CONFIG_MODES: ReasoningConfigMode[] = ['automatic', 'manual'];
export const REASONING_OUTPUTS: ReasoningOutput[] = ['none', 'summary'];

/**
 * Admin reasoning capability configuration (Phase 8).
 *
 * An absent field leaves the stored value untouched; an explicit `null` resets
 * that capability to `unknown`. `@IsOptional()` skips validation for `null`, so
 * `null` reaches the service while any other value is still type-checked.
 */
export class ReasoningConfigDto {
  @IsOptional()
  @IsIn(REASONING_CONFIG_MODES, { message: 'mode must be one of automatic, manual' })
  mode?: ReasoningConfigMode;

  @IsOptional()
  @IsBoolean()
  supported?: boolean | null;

  @IsOptional()
  @IsIn(REASONING_OUTPUTS, { message: 'output must be one of none, summary' })
  output?: ReasoningOutput | null;

  @IsOptional()
  @IsBoolean()
  streaming?: boolean | null;
}

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
  @IsString()
  @Matches(PROVIDER_ID_PATTERN, { message: 'providerId must contain only lowercase letters, numbers, and hyphens' })
  providerId?: string;

  @IsOptional()
  @IsIn(MODEL_VISIBILITIES as unknown as string[], {
    message: 'visibility must be one of public, commercial, private',
  })
  visibility?: ModelVisibility;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Fallback model id. `null` clears the fallback; the field being absent
   * leaves it untouched. `@ValidateIf` is what lets `null` through as an
   * instruction while a supplied value must still be a UUID.
   */
  @IsOptional()
  @ValidateIf((o: ModelUpsertDto) => o.fallbackModelId !== null)
  @IsUUID()
  fallbackModelId?: string | null;

  /** Reasoning capability configuration. Absent leaves it untouched. */
  @IsOptional()
  @ValidateNested()
  @Type(() => ReasoningConfigDto)
  reasoning?: ReasoningConfigDto;
}
