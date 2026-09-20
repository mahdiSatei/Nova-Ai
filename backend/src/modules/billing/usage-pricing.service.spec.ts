import { UsagePricingService } from './usage-pricing.service';

describe('UsagePricingService', () => {
  const build = (overrides: Partial<Record<string, unknown>> = {}) => {
    const pricing = {
      getCreditPriceToman: () => 100,
      getWebSearchPriceToman: () => 1000,
      getModelPricing: jest
        .fn()
        .mockResolvedValue({ inputPricePer1m: 500_000, outputPricePer1m: 1_000_000 }),
      ...overrides,
    };
    return { pricing, svc: new UsagePricingService(pricing as never) };
  };

  it('prices input and output tokens at their per-1M Toman rates', async () => {
    const { svc } = build();
    // input:  1,000 × 500,000 / 1e6 = 500 Toman
    // output:   500 × 1,000,000 / 1e6 = 500 Toman
    // total: 1,000 Toman → 10 Credits at 100 Toman/Credit
    await expect(svc.calculateLlmCost('m-1', 1_000, 500, 0)).resolves.toEqual({
      chargedCost: 1000,
      chargedCredits: 10,
    });
  });

  it('bills reasoning tokens at the output rate', async () => {
    const { svc } = build();
    // (500 + 500) × 1,000,000 / 1e6 = 1,000 Toman of output
    const cost = await svc.calculateLlmCost('m-1', 0, 500, 500);
    expect(cost.chargedCost).toBe(1000);
    expect(cost.chargedCredits).toBe(10);
  });

  it('rounds Credits half-up to the wallet precision', async () => {
    const { svc } = build({
      getModelPricing: jest.fn().mockResolvedValue({ inputPricePer1m: 1, outputPricePer1m: 0 }),
    });
    // 1 token × 1 Toman/1M = 0.000001 Toman = 0.00000001 Credits → 0
    const cost = await svc.calculateLlmCost('m-1', 1, 0, 0);
    expect(cost.chargedCost).toBeCloseTo(0.000001, 10);
    expect(cost.chargedCredits).toBe(0);

    // 250 tokens × 1 Toman/1M = 0.00025 Toman = 0.0000025 Credits → 0
    const tiny = await svc.calculateLlmCost('m-1', 250, 0, 0);
    expect(tiny.chargedCredits).toBe(0);

    // 50,000 tokens × 1 Toman/1M = 0.05 Toman = 0.0005 Credits (exactly representable)
    const half = await svc.calculateLlmCost('m-1', 50_000, 0, 0);
    expect(half.chargedCredits).toBe(0.0005);
  });

  it('calculates the web-search cost in Credits', () => {
    const { svc } = build();
    // 1,000 Toman per search ÷ 100 Toman per Credit = 10 Credits
    expect(svc.calculateWebSearchCost()).toBe(10);
  });

  it('returns 0 Credits when the Credit price is not configured', () => {
    const { svc } = build({ getCreditPriceToman: () => 0 });
    expect(svc.calculateWebSearchCost()).toBe(0);
  });
});
