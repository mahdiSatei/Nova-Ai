import { IsString, IsUrl, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Body for PUT /v1/admin/provider.
 *
 * `baseUrl` must be a syntactically valid http(s) URL. `apiKey` is the
 * cleartext credential, encrypted with AES-256-GCM at rest and never
 * returned in any response.
 */
export class CentralProviderUpdateDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl!: string;

  @IsString()
  @MinLength(8, { message: 'apiKey must be at least 8 characters' })
  @MaxLength(500)
  @Matches(/^[\x21-\x7e]+$/, { message: 'apiKey must contain only printable ASCII characters' })
  apiKey!: string;
}
