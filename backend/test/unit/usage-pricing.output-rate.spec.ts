import { UsagePricingService } from '../../src/modules/billing/usage-pricing.service';

describe('UsagePricingService.getOutputCreditRate', () => {
  it('returns unrounded credits per output token', async () => {
    const pricing = {
      getModelPricing: jest.fn().mockResolvedValue({
        inputPricePer1m: 1,
        outputPricePer1m: 2_000_000,
      }),
      getCreditPriceToman: jest.fn().mockReturnValue(100_000),
    };
    const svc = new UsagePricingService(pricing as never);

    // 2,000,000 Toman / 1M tokens = 2 Toman per token; credit = 100,000 Toman.
    await expect(svc.getOutputCreditRate('model-1')).resolves.toBeCloseTo(0.00002, 8);
  });

  it('returns 0 when the credit price is misconfigured, disabling the budget check', async () => {
    const pricing = {
      getModelPricing: jest.fn().mockResolvedValue({
        inputPricePer1m: 1,
        outputPricePer1m: 2_000_000,
      }),
      getCreditPriceToman: jest.fn().mockReturnValue(0),
    };
    const svc = new UsagePricingService(pricing as never);

    await expect(svc.getOutputCreditRate('model-1')).resolves.toBe(0);
  });
});
