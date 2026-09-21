import { UsagePricingService } from '../../src/modules/billing/usage-pricing.service';

describe('UsagePricingService.calculateWebSearchCost', () => {
  it('converts the fixed Toman price to Credits at the Credit rate', () => {
    const pricing = {
      getCreditPriceToman: jest.fn().mockReturnValue(100),
      getWebSearchPriceToman: jest.fn().mockReturnValue(1000),
    };
    const svc = new UsagePricingService(pricing as never);

    // 1000 Toman ÷ 100 Toman/Credit = 10 Credits
    expect(svc.calculateWebSearchCost()).toBe(10);
  });

  it('handles the default example price (1000 Toman / 100 = 10 Credits)', () => {
    const pricing = {
      getCreditPriceToman: jest.fn().mockReturnValue(100),
      getWebSearchPriceToman: jest.fn().mockReturnValue(1000),
    };
    const svc = new UsagePricingService(pricing as never);
    expect(svc.calculateWebSearchCost()).toBe(10);
  });

  it('returns 0 when the Credit price is misconfigured, disabling search billing', () => {
    const pricing = {
      getCreditPriceToman: jest.fn().mockReturnValue(0),
      getWebSearchPriceToman: jest.fn().mockReturnValue(1000),
    };
    const svc = new UsagePricingService(pricing as never);
    expect(svc.calculateWebSearchCost()).toBe(0);
  });

  it('rounds to the wallet precision (4 decimal places)', () => {
    // 3000 Toman / 700 Toman-per-Credit = 4.2857142857... Credits
    // → rounds to 4.2857 at 4 decimals (mcredit arithmetic)
    const pricing = {
      getCreditPriceToman: jest.fn().mockReturnValue(700),
      getWebSearchPriceToman: jest.fn().mockReturnValue(3000),
    };
    const svc = new UsagePricingService(pricing as never);
    expect(svc.calculateWebSearchCost()).toBe(4.2857);
  });

  it('returns 0 when the search price is 0', () => {
    const pricing = {
      getCreditPriceToman: jest.fn().mockReturnValue(100),
      getWebSearchPriceToman: jest.fn().mockReturnValue(0),
    };
    const svc = new UsagePricingService(pricing as never);
    expect(svc.calculateWebSearchCost()).toBe(0);
  });
});
