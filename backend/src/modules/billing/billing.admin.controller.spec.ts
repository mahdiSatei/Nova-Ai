import { BillingAdminController } from './billing.admin.controller';
import { PricingService } from './pricing.service';

describe('BillingAdminController', () => {
  it('returns the read-only billing configuration', async () => {
    const pricing = {
      getCreditPriceToman: () => 100,
      getWebSearchPriceToman: () => 1000,
    };
    const ctrl = new BillingAdminController(pricing as unknown as PricingService);
    expect(ctrl.getConfig()).toEqual({ creditPriceToman: 100, webSearchPriceToman: 1000 });
  });
});
