import { NotFoundException } from '@nestjs/common';
import { PricingService } from './pricing.service';

describe('PricingService', () => {
  const configFor = (values: Record<string, number>) =>
    ({ get: jest.fn((key: string) => values[key]) }) as never;

  it('reads the Credit price from configuration', () => {
    const svc = new PricingService(
      configFor({ 'billing.creditPriceToman': 100, 'billing.webSearchPriceToman': 1000 }),
      null as never,
    );
    expect(svc.getCreditPriceToman()).toBe(100);
  });

  it('reads the web-search price from configuration', () => {
    const svc = new PricingService(
      configFor({ 'billing.creditPriceToman': 100, 'billing.webSearchPriceToman': 1000 }),
      null as never,
    );
    expect(svc.getWebSearchPriceToman()).toBe(1000);
  });

  it('reads model pricing as numbers', async () => {
    const modelRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'm-1',
        inputPricePer1m: '500000.0000',
        outputPricePer1m: '1000000.0000',
      }),
    };
    const svc = new PricingService(configFor({}), modelRepo as never);
    await expect(svc.getModelPricing('m-1')).resolves.toEqual({
      inputPricePer1m: 500000,
      outputPricePer1m: 1000000,
    });
  });

  it('throws model_not_found for an unknown model', async () => {
    const modelRepo = { findOne: jest.fn().mockResolvedValue(null) };
    const svc = new PricingService(configFor({}), modelRepo as never);
    const err = await svc.getModelPricing('missing').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err.getResponse()).toMatchObject({ code: 'model_not_found' });
  });
});
