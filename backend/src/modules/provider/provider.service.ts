import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider, ProviderType } from './entities/provider.entity';
import { encrypt, decrypt } from '../../common/crypto/credential-cipher';
import { ProviderAdapter } from './adapters/provider-adapter.interface';
import { NormalizedProviderError } from './errors/normalized-provider.error';

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
}

export interface ProviderAdmin extends ProviderPublic {
  apiKeyMasked: string;
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

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name);
  private readonly adapters: ProviderAdapter[];

  constructor(
    @InjectRepository(Provider)
    private readonly repo: Repository<Provider>,
    @Inject(PROVIDER_ADAPTERS) adapters: ProviderAdapter[],
  ) {
    this.adapters = adapters;
  }

  async list(page = 1, pageSize = 20): Promise<{ items: ProviderAdmin[]; total: number; page: number; pageSize: number }> {
    const [rows, total] = await this.repo.findAndCount({
      order: { name: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((r) => this.toAdmin(r)), total, page, pageSize };
  }

  async read(id: string): Promise<ProviderAdmin> {
    const provider = await this.repo.findOne({ where: { id } });
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

    const encrypted = encrypt(input.apiKey);
    const provider = this.repo.create({
      id: input.id,
      name: input.name,
      type: input.type,
      baseUrl: input.baseUrl,
      apiKeyEncrypted: encrypted,
      isActive: input.isActive ?? true,
    });
    const saved = await this.repo.save(provider);
    return this.toAdmin(saved);
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
    if (input.baseUrl !== undefined) provider.baseUrl = input.baseUrl;
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

    const adapter = this.adapters.find((a) => (a as any).supports?.(provider.type) ?? true);
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
        throw new UnprocessableEntityException({
          code: err.code,
          message: err.message,
        });
      }
      throw err as Error;
    }

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
      lastValidatedAt: null,
      createdAt: provider.createdAt.toISOString(),
      updatedAt: provider.updatedAt.toISOString(),
    };
  }

  private toAdmin(provider: Provider): ProviderAdmin {
    let plain: string;
    try {
      plain = decrypt(provider.apiKeyEncrypted);
    } catch {
      plain = '***';
    }
    return {
      ...this.toPublic(provider),
      apiKeyMasked: this.mask(plain),
    };
  }

  private mask(plain: string): string {
    if (plain.length <= 4) return '***';
    return `***${plain.slice(-4)}`;
  }
}
