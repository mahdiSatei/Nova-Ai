import { IsString, IsBoolean, IsOptional, MaxLength, MinLength, Matches } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/^[\x21-\x7e]+$/, { message: 'apiKey must contain only printable ASCII characters' })
  apiKey!: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
