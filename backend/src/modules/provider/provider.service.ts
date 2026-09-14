import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CentralProvider } from './entities/central-provider.entity';
import { decrypt, encrypt } from '../../common/crypto/credential-cipher';

export interface CentralProviderPublic {
  baseUrl: string;
  apiKeyMasked: string;
  isConfigured: true;
  lastValidatedAt: string | null;
}

export interface CentralProviderUnconfigured {
  isConfigured: false;
}

/**
 * Business logic for the central-provider singleton row.
 *
 * The credential is encrypted at rest with AES-256-GCM and never
 * returned in cleartext. `GET` returns a masked form (last 4 chars
 * prefixed `***`); `PUT` validates the credential against the provider
 * with a minimal non-streaming call BEFORE persisting.
 */
@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);

  constructor(
    @InjectRepository(CentralProvider)
    private readonly repo: Repository<CentralProvider>,
  ) {}

  async read(): Promise<CentralProviderPublic | CentralProviderUnconfigured> {
    const row = await this.repo.findOne({ where: { id: 'singleton' } });
    if (!row) return { isConfigured: false };

    const plain = decrypt(row.apiKeyEncrypted);
    return {
      baseUrl: row.baseUrl,
      apiKeyMasked: this.mask(plain),
      isConfigured: true,
      lastValidatedAt: row.lastValidatedAt ? row.lastValidatedAt.toISOString() : null,
    };
  }

  async readOrThrow(): Promise<CentralProviderPublic> {
    const result = await this.read();
    if (!result.isConfigured) {
      throw new NotFoundException({
        code: 'not_found',
        message: 'Central provider is not configured.',
      });
    }
    return result;
  }

  async update(input: { baseUrl: string; apiKey: string }): Promise<CentralProviderPublic> {
    // Probe FIRST so we never persist invalid credentials.
    await this.probe(input.baseUrl, input.apiKey);

    const encrypted = encrypt(input.apiKey);
    const existing = await this.repo.findOne({ where: { id: 'singleton' } });

    const nextValidatedAt = new Date();
    if (existing) {
      existing.baseUrl = input.baseUrl;
      existing.apiKeyEncrypted = encrypted;
      existing.lastValidatedAt = nextValidatedAt;
      await this.repo.save(existing);
    } else {
      await this.repo.save(
        this.repo.create({
          id: 'singleton',
          baseUrl: input.baseUrl,
          apiKeyEncrypted: encrypted,
          lastValidatedAt: nextValidatedAt,
        }),
      );
    }

    const plain = decrypt(encrypted);
    return {
      baseUrl: input.baseUrl,
      apiKeyMasked: this.mask(plain),
      isConfigured: true,
      lastValidatedAt: nextValidatedAt.toISOString(),
    };
  }

  async getDecryptedApiKey(): Promise<{ baseUrl: string; apiKey: string }> {
    const row = await this.repo.findOne({ where: { id: 'singleton' } });
    if (!row) {
      throw new UnprocessableEntityException({
        code: 'provider_not_configured',
        message: 'Central provider is not configured.',
      });
    }
    return {
      baseUrl: row.baseUrl,
      apiKey: decrypt(row.apiKeyEncrypted),
    };
  }

  private async probe(baseUrl: string, apiKey: string): Promise<void> {
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'probe',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
      });
    } catch (err) {
      this.logger.warn(`Provider probe failed (network): ${(err as Error).message}`);
      throw new UnprocessableEntityException({
        code: 'provider_unreachable',
        message: 'The AI provider could not be reached. Check the base URL and try again.',
      });
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      this.logger.warn(`Provider probe failed (status=${response.status}): ${detail}`);
      throw new UnprocessableEntityException({
        code: 'credentials_rejected',
        message: `The AI provider rejected the credentials (HTTP ${response.status}).`,
      });
    }
  }

  private mask(plain: string): string {
    if (plain.length <= 4) return '***';
    return `***${plain.slice(-4)}`;
  }
}
