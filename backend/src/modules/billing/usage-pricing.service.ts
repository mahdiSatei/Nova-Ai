import { Injectable } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { MCREDITS_PER_CREDIT } from '../wallet/wallet.service';

export interface ChargedCost {
  /** Cost in Toman, full precision as computed from the model's prices. */
  chargedCost: number;
  /** Credits to deduct, rounded to the wallet's 4-decimal precision. */
  chargedCredits: number;
}

/**
 * The single place token usage is turned into money (Phase 5 §1.8).
 *
 *   cost(Toman) = inputTokens × inputPricePer1m / 1e6
 *               + (outputTokens + reasoningTokens) × outputPricePer1m / 1e6
 *
 * Reasoning tokens bill at the output rate — providers charge for them as
 * completion tokens, they are just broken out so the admin report can show them.
 *
 * The Toman → Credit conversion is done in integer sub-credit units and rounded
 * half-up at the wallet's scale, so `chargedCredits` is always a value the wallet
 * can actually store.
 */
@Injectable()
export class UsagePricingService {
  constructor(private readonly pricing: PricingService) {}

  async calculateLlmCost(
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    reasoningTokens: number,
  ): Promise<ChargedCost> {
    const { inputPricePer1m, outputPricePer1m } = await this.pricing.getModelPricing(modelId);
    const creditPriceToman = this.pricing.getCreditPriceToman();

    const inputCostToman = (inputTokens * inputPricePer1m) / 1_000_000;
    const outputCostToman = ((outputTokens + reasoningTokens) * outputPricePer1m) / 1_000_000;
    const chargedCost = Math.round((inputCostToman + outputCostToman) * 1e8) / 1e8;

    const chargedCredits = this.tomanToCredits(chargedCost, creditPriceToman);
    return { chargedCost, chargedCredits };
  }

  /** Credits charged for a single web search. */
  calculateWebSearchCost(): number {
    return this.tomanToCredits(
      this.pricing.getWebSearchPriceToman(),
      this.pricing.getCreditPriceToman(),
    );
  }

  /** Toman → Credits, rounded half-up to the wallet's stored precision. */
  private tomanToCredits(toman: number, creditPriceToman: number): number {
    if (creditPriceToman <= 0) return 0;
    const subCredits = Math.round((toman * MCREDITS_PER_CREDIT) / creditPriceToman);
    return subCredits / MCREDITS_PER_CREDIT;
  }
}
