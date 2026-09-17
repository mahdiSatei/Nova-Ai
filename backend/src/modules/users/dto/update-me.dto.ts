import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * PATCH /v1/users/me body. Both fields are optional; at least one must
 * be present (validated in the controller). `displayName` is trimmed
 * by the controller; a whitespace-only value clears the stored name.
 * `avatarSeed` is stored verbatim (the client sends a UUID); when set
 * it drives the identicon instead of the user id.
 */
export class UpdateMeRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(50, { message: 'displayName must be at most 50 characters' })
  displayName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'avatarSeed must not be empty' })
  @MaxLength(64, { message: 'avatarSeed must be at most 64 characters' })
  avatarSeed?: string;
}
