import { IsString, IsUrl, IsEnum, MaxLength, MinLength, Matches } from 'class-validator';

export const PROVIDER_ID_PATTERN = /^[a-z0-9-]+$/;
export const PROVIDER_TYPES = ['openai-compatible', 'custom-openai-compatible'] as const;
export type ProviderType = typeof PROVIDER_TYPES[number];

export class CreateProviderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(PROVIDER_ID_PATTERN, { message: 'id must contain only lowercase letters, numbers, and hyphens' })
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsEnum(PROVIDER_TYPES)
  type!: ProviderType;

  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/^[\x21-\x7e]+$/, { message: 'apiKey must contain only printable ASCII characters' })
  apiKey!: string;
}
