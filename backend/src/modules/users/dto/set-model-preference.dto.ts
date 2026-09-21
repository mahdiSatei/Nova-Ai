import { IsOptional, IsString } from 'class-validator';

/**
 * PATCH /v1/users/me/model-preference body.
 * When modelId is provided as a string, the service validates it
 * exists and is enabled. When null or omitted, the preference is cleared.
 */
export class SetModelPreferenceDto {
  @IsOptional()
  @IsString()
  modelId?: string | null;
}
