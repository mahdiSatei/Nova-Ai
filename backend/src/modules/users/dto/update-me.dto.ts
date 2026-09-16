import { IsString, MaxLength } from 'class-validator';

/**
 * PATCH /v1/users/me body. `displayName` is trimmed by the controller;
 * a whitespace-only value clears the stored name (stores null).
 */
export class UpdateMeRequestDto {
  @IsString()
  @MaxLength(50, { message: 'displayName must be at most 50 characters' })
  displayName!: string;
}
