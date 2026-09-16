import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterRequestDto {
  /**
   * 3-20 chars, letters/digits/underscore. Stored lowercased by the
   * service; uniqueness is case-insensitive.
   */
  @IsString()
  @Matches(/^[a-zA-Z0-9_]{3,20}$/, {
    message: 'username must be 3-20 characters: letters, digits, or underscore',
  })
  username!: string;

  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  password!: string;
}
