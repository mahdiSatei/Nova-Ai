import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginRequestDto {
  /**
   * Either an email or a username. The service resolves '@'-containing
   * values by email, everything else by username.
   */
  @IsString()
  @MinLength(3, { message: 'identifier must be at least 3 characters' })
  @MaxLength(128, { message: 'identifier must be at most 128 characters' })
  identifier!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  password!: string;
}
