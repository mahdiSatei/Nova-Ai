import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterRequestDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString()
  @MinLength(8, { message: 'password must be at least 8 characters' })
  @MaxLength(128, { message: 'password must be at most 128 characters' })
  password!: string;
}
