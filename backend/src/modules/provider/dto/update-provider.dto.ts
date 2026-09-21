import { IsOptional, IsString, IsUrl, IsEnum, MaxLength, Matches, MinLength } from 'class-validator';
import { ProviderType, PROVIDER_TYPES } from './create-provider.dto';

export class UpdateProviderDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  type?: ProviderType;

  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(500)
  @Matches(/^[\x21-\x7e]+$/, { message: 'apiKey must contain only printable ASCII characters' })
  apiKey?: string;

  @IsOptional()
  isActive?: boolean;
}
