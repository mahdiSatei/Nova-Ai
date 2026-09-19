import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider } from './entities/provider.entity';
import { ProviderAdapter } from './adapters/provider-adapter.interface';
import { ModelsService } from '../models/models.service';
import { ProviderService, PROVIDER_ADAPTERS } from './provider.service';
import {
  ProviderChatMessage,
  ProviderReasoningRequest,
  ProviderStreamChunk,
  ProviderToolDefinition,
} from './adapters/provider-adapter.interface';
import { encrypt } from '../../common/crypto/credential-cipher';

export interface ProviderConnection {
  provider: Provider;
  adapter: ProviderAdapter;
}

export interface ChatProviderInput {
  model: string;
  messages: ProviderChatMessage[];
  tools?: ProviderToolDefinition[];
  /** Phase 8 — normalized reasoning request, translated by the adapter. */
  reasoning?: ProviderReasoningRequest;
}

@Injectable()
export class ProviderRuntimeService {
  /** Per-provider round-robin counter (in-memory; resets on restart). */
  private readonly roundRobinCounters = new Map<string, number>();

  constructor(
    private readonly models: ModelsService,
    @InjectRepository(Provider) private readonly providerRepo: Repository<Provider>,
    @Inject(PROVIDER_ADAPTERS) private readonly adapters: ProviderAdapter[],
    private readonly providerService: ProviderService,
  ) {}

  async assertReady(modelId: string): Promise<ProviderConnection> {
    const model = await this.models.findById(modelId);
    const provider = await this.providerRepo.findOne({ where: { id: model.providerId } });
    if (!provider) {
      throw new NotFoundException({ code: 'provider_not_found', message: 'Model provider not found.' });
    }
    if (!provider.isActive) {
      throw new NotFoundException({ code: 'provider_inactive', message: 'Model provider is inactive.' });
    }
    const adapter = this.adapters.find(
      (a) =>
        (a as { supports?: (type: string) => boolean }).supports?.(provider.type) ?? true,
    );
    if (!adapter) {
      throw new NotFoundException({ code: 'provider_type_unsupported', message: `No adapter for provider type: ${provider.type}` });
    }
    return { provider, adapter };
  }

  /**
   * Open a provider stream. If the model has a `preferredApiKeyId`, that
   * specific key is used; otherwise keys are rotated in round-robin order
   * across all active keys for the provider.
   */
  async stream(connection: ProviderConnection, input: ChatProviderInput, preferredApiKeyId?: string | null): Promise<AsyncIterable<ProviderStreamChunk>> {
    const apiKey = await this.providerService.selectApiKey(
      connection.provider.id,
      preferredApiKeyId,
    );

    // Create a modified provider with the selected key encrypted
    const providerWithKey = {
      ...connection.provider,
      apiKeyEncrypted: encrypt(apiKey),
    };

    return connection.adapter.stream(providerWithKey, input);
  }
}
