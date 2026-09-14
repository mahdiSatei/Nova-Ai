import { IsOptional, IsUUID } from 'class-validator';

/**
 * Body for PUT /v1/admin/config. `defaultModelId` is nullable — sending
 * `null` clears the default.
 */
export class AppConfigUpdateDto {
  @IsOptional()
  @IsUUID('4', { message: 'defaultModelId must be a UUIDv4 or null' })
  defaultModelId?: string | null;
}
