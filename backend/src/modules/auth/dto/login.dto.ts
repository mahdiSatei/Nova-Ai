import { IsEmail, IsString } from 'class-validator';

export class LoginRequestDto {
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString()
  password!: string;
}
