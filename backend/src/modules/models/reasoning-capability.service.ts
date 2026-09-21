import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Provider } from '../provider/entities/provider.entity';
import { PROVIDER_ADAPTERS } from '../provider/provider.service';
import type { ProviderAdapter } from '../provider/adapters/provider-adapter.interface';
import { signalsToCapability } from '../reasoning/reasoning.capability';
import type { ReasoningCapability, ReasoningCapabilitySources } from '../reasoning/reasoning.types';

export interface ReasoningDiscoveryResult {
  capability: ReasoningCapability;
  sources: ReasoningCapabilitySources;
  discoveredAt: string;
}

/**
 * Discovery orchestration for Phase 8 (spec §Capability Discovery and Configuration).
 *
 * Reads explicit provider metadata through the adapter. It never issues a
 * generation request and never falls back to guessing from the model name: any
 * unreliable or missing information stays `unknown`.
 */
@Injectable()
export class ReasoningCapabilityService {
  private readonly logger = new Logger(ReasoningCapabilityService.name);

  constructor(
    @InjectRepository(Provider)
    private readonly providerRepo: Repository<Provider>,
    @Inject(PROVIDER_ADAPTERS)
    private readonly adapters: ProviderAdapter[],
  ) {}

  async discover(input: {
    providerId: string;
    modelName: string;
  }): Promise<ReasoningDiscoveryResult> {
    const discoveredAt = new Date().toISOString();
    const unknown = signalsToCapability(null);

    const provider = await this.providerRepo.findOne({ where: { id: input.providerId } });
    if (!provider || !provider.isActive) {
      return { capability: unknown.capability, sources: unknown.sources, discoveredAt };
    }

    const adapter = this.adapters.find(
      (candidate) =>
        (candidate as { supports?: (type: string) => boolean }).supports?.(provider.type) ?? true,
    );
    if (!adapter?.discoverCapabilities) {
      return { capability: unknown.capability, sources: unknown.sources, discoveredAt };
    }

    try {
      const signals = await adapter.discoverCapabilities(provider, input.modelName);
      const mapped = signalsToCapability(signals);
      return { capability: mapped.capability, sources: mapped.sources, discoveredAt };
    } catch (err) {
      this.logger.warn(
        `Reasoning discovery failed for provider=${input.providerId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { capability: unknown.capability, sources: unknown.sources, discoveredAt };
    }
  }
}
