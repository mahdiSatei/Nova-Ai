import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '../../config/configuration';
import { Model } from '../models/entities/model.entity';

export interface ModelPricing {
  /** Toman per 1,000,000 input tokens. */
  inputPricePer1m: number;
  /** Toman per 1,000,000 output tokens. */
  outputPricePer1m: number;
}

/**
 * Read-only price source for the billing stack (Phase 5 §1.8).
 *
 * Prices come from two places: the deployment-level Credit rate (env, never
 * editable through the API) and the per-model Toman prices stored on `models`.
 * Keeping both behind this service means consumers never have to know which is
 * which.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    @InjectRepository(Model)
    private readonly modelRepo: Repository<Model>,
  ) {}

  /** Toman charged for one Credit. Deployment-configured, read-only. */
  getCreditPriceToman(): number {
    return Number(this.config.get('billing.creditPriceToman', { infer: true }));
  }

  /** Toman charged for one web search. */
  getWebSearchPriceToman(): number {
    return Number(this.config.get('billing.webSearchPriceToman', { infer: true }));
  }

  async getModelPricing(modelId: string): Promise<ModelPricing> {
    const model = await this.modelRepo.findOne({ where: { id: modelId } });
    if (!model) {
      throw new NotFoundException({ code: 'model_not_found', message: 'Model not found.' });
    }
    return {
      inputPricePer1m: Number(model.inputPricePer1m),
      outputPricePer1m: Number(model.outputPricePer1m),
    };
  }
}
