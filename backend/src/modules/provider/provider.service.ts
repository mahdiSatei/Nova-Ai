import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { AppConfig } from '../../config/configuration';
import { Provider, ProviderType } from './entities/provider.entity';
import { ProviderApiKey } from './entities/provider-api-key.entity';
import { encrypt, decrypt } from '../../common/crypto/credential-cipher';
import { ProviderAdapter } from './adapters/provider-adapter.interface';
import { NormalizedProviderError } from './errors/normalized-provider.error';
import { validateProviderUrl } from './utils/url-policy';

export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');

export interface ProviderPublic {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  hasApiKey: boolean;
  isActive: boolean;
  lastValidatedAt: string | null;
  createdAt: string;
  updatedAt: string;
  apiKeys?: ApiKeyPublic[];
}

export type ProviderAdmin = ProviderPublic;

export interface ApiKeyPublic {
  id: string;
  label: string;
  isActive: boolean;
  lastValidatedAt: string | null;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCreateInput {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  isActive?: boolean;
}

export interface ProviderUpdateInput {
  name?: string;
  baseUrl?: string;
  apiKey?: string;
  isActive?: boolean;
}

export interface ApiKeyCreateInput {
  label: string;
  apiKey: string;
  isActive?: boolean;
}

export interface ApiKeyUpdateInput {
  label?: string;
  apiKey?: string;
  isActive?: boolean;
}

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);
  private readonly adapters: ProviderAdapter[];

  constructor(
    @InjectRepository(Provider)
    private readonly repo: Repository<Provider>,
    @InjectRepository(ProviderApiKey)
    private readonly apiKeyRepo: Repository<ProviderApiKey>,
    @Inject(PROVIDER_ADAPTERS) adapters: ProviderAdapter[],
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.adapters = adapters;
  }

  async list(page = 1, pageSize = 20): Promise<{ items: ProviderAdmin[]; total: number; page: number; pageSize: number }> {
    const [rows, total] = await this.repo.findAndCount({
      relations: ['apiKeys'],
      order: { name: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((r) => this.toAdmin(r)), total, page, pageSize };
  }

  async read(id: string): Promise<ProviderAdmin> {
    const provider = await this.repo.findOne({
      where: { id },
      relations: ['apiKeys'],
    });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });
    return this.toAdmin(provider);
  }

  async create(input: ProviderCreateInput): Promise<ProviderAdmin> {
    const dup = await this.repo
      .createQueryBuilder('p')
      .where('LOWER(p.name) = LOWER(:name)', { name: input.name })
      .getOne();
    if (dup) {
      throw new ConflictException({ code: 'provider_name_taken', message: 'A provider with that name already exists.' });
    }

    // Explicit id check: TypeORM's `save` upserts when the PK already exists
    // (INSERT … ON CONFLICT semantics via existence probing), which would
    // silently overwrite another provider — and even mutate it in place when
    // the create raced. Guard the contract instead.
    const dupId = await this.repo.findOne({ where: { id: input.id } });
    if (dupId) {
      throw new ConflictException({ code: 'provider_id_taken', message: 'A provider with that id already exists.' });
    }

    const urlCheck = validateProviderUrl(input.baseUrl, this.config.get('nodeEnv'));
    if (!urlCheck.ok) {
      throw new UnprocessableEntityException({
        code: 'provider_url_invalid',
        message: urlCheck.reason ?? 'Invalid provider URL.',
      });
    }

    const encrypted = encrypt(input.apiKey);
    const provider = this.repo.create({
      id: input.id,
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      apiKeyEncrypted: encrypted,
      isActive: input.isActive ?? true,
    });
    try {
      const saved = await this.repo.save(provider);
      return this.toAdmin(saved);
    } catch (err) {
      // A concurrent create with the same id surfaces as a unique-violation
      // (SQLSTATE 23505); report it as a client conflict, not a 500.
      const code = (err as { code?: string; driverError?: { code?: string } })?.code ??
        (err as { driverError?: { code?: string } })?.driverError?.code;
      if (code === '23505') {
        throw new ConflictException({ code: 'provider_id_taken', message: 'A provider with that id already exists.' });
      }
      throw err as Error;
    }
  }

  async update(id: string, input: ProviderUpdateInput): Promise<ProviderAdmin> {
    const provider = await this.repo.findOne({ where: { id } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });

    if (input.name !== undefined && input.name !== provider.name) {
      const dup = await this.repo
        .createQueryBuilder('p')
        .where('LOWER(p.name) = LOWER(:name) AND p.id <> :id', { name: input.name, id })
        .getOne();
      if (dup) {
        throw new ConflictException({ code: 'provider_name_taken', message: 'A provider with that name already exists.' });
      }
      provider.name = input.name;
    }
    if (input.baseUrl !== undefined) {
      const urlCheck = validateProviderUrl(input.baseUrl, this.config.get('nodeEnv'));
      if (!urlCheck.ok) {
        throw new UnprocessableEntityException({
          code: 'provider_url_invalid',
          message: urlCheck.reason ?? 'Invalid provider URL.',
        });
      }
      provider.baseUrl = input.baseUrl;
    }
    if (input.isActive !== undefined) provider.isActive = input.isActive;
    if (input.apiKey !== undefined) provider.apiKeyEncrypted = encrypt(input.apiKey);

    const saved = await this.repo.save(provider);
    return this.toAdmin(saved);
  }

  async delete(id: string): Promise<void> {
    const provider = await this.repo.findOne({ where: { id } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });
    await this.repo.delete(id);
  }

  async getDecryptedCredential(id: string): Promise<{ baseUrl: string; apiKey: string }> {
    const provider = await this.repo.findOne({ where: { id } });
    if (!provider) {
      throw new UnprocessableEntityException({ code: 'provider_not_configured', message: 'Provider not found.' });
    }
    try {
      return { baseUrl: provider.baseUrl, apiKey: decrypt(provider.apiKeyEncrypted) };
    } catch {
      throw new UnprocessableEntityException({
        code: 'provider_credential_corrupt',
        message: 'Stored provider credential cannot be decrypted. Re-enter the API key.',
      });
    }
  }

  async validateProvider(id: string): Promise<ProviderAdmin> {
    const provider = await this.repo.findOne({ where: { id } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });

    const adapter = this.adapters.find(
      (a) =>
        (a as { supports?: (type: string) => boolean }).supports?.(provider.type) ?? true,
    );
    if (!adapter) {
      throw new UnprocessableEntityException({
        code: 'provider_type_unsupported',
        message: `No adapter registered for provider type: ${provider.type}`,
      });
    }

    try {
      await adapter.validate(provider);
    } catch (err) {
      if (err instanceof NormalizedProviderError) {
        throw new HttpException({
          code: err.code,
          message: err.message,
        }, err.statusCode);
      }
      throw err as Error;
    }

    provider.lastValidatedAt = new Date();
    const saved = await this.repo.save(provider);
    return this.toAdmin(saved);
  }

  private toPublic(provider: Provider): ProviderPublic {
    let hasKey = false;
    let plain: string;
    try {
      plain = decrypt(provider.apiKeyEncrypted);
      hasKey = plain.length > 0;
    } catch {
      plain = '***';
      hasKey = false;
    }
    return {
      id: provider.id,
      name: provider.name,
      type: provider.type,
      baseUrl: provider.baseUrl,
      hasApiKey: hasKey,
      isActive: provider.isActive,
      lastValidatedAt: provider.lastValidatedAt?.toISOString() ?? null,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    };
  }

  private toAdmin(provider: Provider): ProviderAdmin {
    const publicProvider = this.toPublic(provider);
    if (provider.apiKeys && Array.isArray(provider.apiKeys)) {
      publicProvider.apiKeys = provider.apiKeys.map((k) => this.toApiKeyPublic(k));
    }
    return publicProvider;
  }

  // ── API Key Management ──────────────────────────────────────────────

  async listApiKeys(providerId: string): Promise<ApiKeyPublic[]> {
    const provider = await this.repo.findOne({ where: { id: providerId } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });

    const keys = await this.apiKeyRepo.find({
      where: { providerId },
      order: { createdAt: 'ASC' },
    });
    return keys.map((k) => this.toApiKeyPublic(k));
  }

  async addApiKey(providerId: string, input: ApiKeyCreateInput): Promise<ApiKeyPublic> {
    const provider = await this.repo.findOne({ where: { id: providerId } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });

    // Check for duplicate label
    const existing = await this.apiKeyRepo.findOne({ where: { providerId, label: input.label } });
    if (existing) {
      throw new ConflictException({ code: 'api_key_label_taken', message: 'An API key with that label already exists.' });
    }

    const encrypted = encrypt(input.apiKey);
    const key = this.apiKeyRepo.create({
      providerId,
      label: input.label,
      apiKeyEncrypted: encrypted,
      isActive: input.isActive ?? true,
    });
    const saved = await this.apiKeyRepo.save(key);
    return this.toApiKeyPublic(saved);
  }

  async updateApiKey(providerId: string, keyId: string, input: ApiKeyUpdateInput): Promise<ApiKeyPublic> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, providerId } });
    if (!key) throw new NotFoundException({ code: 'api_key_not_found', message: 'API key not found.' });

    if (input.label !== undefined && input.label !== key.label) {
      const existing = await this.apiKeyRepo.findOne({ where: { providerId, label: input.label } });
      if (existing) {
        throw new ConflictException({ code: 'api_key_label_taken', message: 'An API key with that label already exists.' });
      }
      key.label = input.label;
    }

    if (input.apiKey !== undefined) {
      key.apiKeyEncrypted = encrypt(input.apiKey);
    }

    if (input.isActive !== undefined) {
      key.isActive = input.isActive;
    }

    const saved = await this.apiKeyRepo.save(key);
    return this.toApiKeyPublic(saved);
  }

  async deleteApiKey(providerId: string, keyId: string): Promise<void> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, providerId } });
    if (!key) throw new NotFoundException({ code: 'api_key_not_found', message: 'API key not found.' });
    await this.apiKeyRepo.delete(keyId);
  }

  async getDecryptedApiKey(providerId: string, keyId: string): Promise<string> {
    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, providerId } });
    if (!key) throw new NotFoundException({ code: 'api_key_not_found', message: 'API key not found.' });
    try {
      return decrypt(key.apiKeyEncrypted);
    } catch {
      throw new UnprocessableEntityException({
        code: 'api_key_corrupt',
        message: 'Stored API key cannot be decrypted. Re-enter the key.',
      });
    }
  }

  /** Per-provider round-robin counter (in-memory; resets on restart). */
  private readonly roundRobinCounters = new Map<string, number>();

  /**
   * Select an API key for a provider. If `preferredApiKeyId` is set and
   * matches an active key, use it; otherwise rotate through active keys
   * in round-robin order. Falls back to the legacy key when no keys exist
   * in `provider_api_keys`.
   */
  async selectApiKey(providerId: string, preferredApiKeyId?: string | null): Promise<string> {
    const activeKeys = await this.apiKeyRepo.find({
      where: { providerId, isActive: true },
    });

    if (activeKeys.length > 0) {
      let selectedKey: ProviderApiKey | undefined;

      // Try the preferred key first
      if (preferredApiKeyId) {
        selectedKey = activeKeys.find((k) => k.id === preferredApiKeyId);
      }

      // Round-robin if no preferred or preferred not found/active
      if (!selectedKey) {
        const counter = (this.roundRobinCounters.get(providerId) ?? 0) % activeKeys.length;
        selectedKey = activeKeys[counter];
        this.roundRobinCounters.set(providerId, counter + 1);
      }

      try {
        return decrypt(selectedKey.apiKeyEncrypted);
      } catch {
        throw new UnprocessableEntityException({
          code: 'api_key_corrupt',
          message: 'Stored API key cannot be decrypted.',
        });
      }
    }

    // Fallback to legacy key
    const provider = await this.repo.findOne({ where: { id: providerId } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });
    try {
      return decrypt(provider.apiKeyEncrypted);
    } catch {
      throw new UnprocessableEntityException({
        code: 'provider_credential_corrupt',
        message: 'Stored provider credential cannot be decrypted. Re-enter the API key.',
      });
    }
  }

  /**
   * Validate a specific API key by probing the provider with that key.
   * Updates lastValidatedAt on success, increments failureCount on failure.
   */
  async validateApiKey(providerId: string, keyId: string): Promise<ApiKeyPublic> {
    const provider = await this.repo.findOne({ where: { id: providerId } });
    if (!provider) throw new NotFoundException({ code: 'provider_not_found', message: 'Provider not found.' });

    const key = await this.apiKeyRepo.findOne({ where: { id: keyId, providerId } });
    if (!key) throw new NotFoundException({ code: 'api_key_not_found', message: 'API key not found.' });

    // Create a temporary provider-like object with this key's credentials for validation
    const tempProvider = {
      ...provider,
      apiKeyEncrypted: key.apiKeyEncrypted,
    } as Provider;

    const adapter = this.adapters.find(
      (a) =>
        (a as { supports?: (type: string) => boolean }).supports?.(provider.type) ?? true,
    );
    if (!adapter) {
      throw new UnprocessableEntityException({
        code: 'provider_type_unsupported',
        message: `No adapter for provider type: ${provider.type}`,
      });
    }

    try {
      await adapter.validate(tempProvider);
      key.lastValidatedAt = new Date();
      key.failureCount = 0;
      const saved = await this.apiKeyRepo.save(key);
      return this.toApiKeyPublic(saved);
    } catch (err) {
      key.failureCount = (key.failureCount || 0) + 1;
      await this.apiKeyRepo.save(key);
      if (err instanceof NormalizedProviderError) {
        throw new HttpException({ code: err.code, message: err.message }, err.statusCode);
      }
      throw new UnprocessableEntityException({
        code: 'api_key_invalid',
        message: 'API key validation failed.',
      });
    }
  }

  private toApiKeyPublic(key: ProviderApiKey): ApiKeyPublic {
    return {
      id: key.id,
      label: key.label,
      isActive: key.isActive,
      lastValidatedAt: key.lastValidatedAt?.toISOString() ?? null,
      failureCount: key.failureCount,
      createdAt: key.createdAt.toISOString(),
      updatedAt: key.updatedAt.toISOString(),
    };
  }
}
