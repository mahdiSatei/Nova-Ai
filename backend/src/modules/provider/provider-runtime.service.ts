import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider } from './entities/provider.entity';
import { ProviderAdapter } from './adapters/provider-adapter.interface';
import { ModelsService } from '../models/models.service';
import { PROVIDER_ADAPTERS } from './provider.service';
import { ProviderChatMessage, ProviderStreamChunk } from './adapters/provider-adapter.interface';

export interface ProviderConnection {
  provider: Provider;
  adapter: ProviderAdapter;
}

export interface ChatProviderInput {
  model: string;
  messages: ProviderChatMessage[];
}

@Injectable()
export class ProviderRuntimeService {
  constructor(
    private readonly models: ModelsService,
    @InjectRepository(Provider) private readonly providerRepo: Repository<Provider>,
    @Inject(PROVIDER_ADAPTERS) private readonly adapters: ProviderAdapter[],
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

  async stream(connection: ProviderConnection, input: ChatProviderInput): Promise<AsyncIterable<ProviderStreamChunk>> {
    return connection.adapter.stream(connection.provider, input);
  }
}
