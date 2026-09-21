import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PaymentsService } from '../../src/modules/payments/payments.service';

describe('PaymentsService.createPurchase', () => {
  let paymentsRepo: Record<string, jest.Mock>;
  let purchasesRepo: Record<string, jest.Mock>;
  let provider: {
    createPayment: jest.Mock;
    toProviderAmount: jest.Mock;
    name: string;
  };
  let svc: PaymentsService;
  let configured: Record<string, unknown>;

  const build = (creditPriceToman = 100, overrides: Record<string, unknown> = {}) => {
    paymentsRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'pay-1', ...x })),
    };
    purchasesRepo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ id: 'pur-1', ...x })),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    provider = {
      name: 'ZIBAL',
      toProviderAmount: jest.fn((toman: number) => toman * 10),
      createPayment: jest.fn(async () => ({
        trackId: '1000',
        providerAmountRial: 2_500_000,
        paymentUrl: 'http://127.0.0.1:3010/start/1000',
      })),
    };
    configured = {
      'billing.creditPriceToman': creditPriceToman,
      'payment.zibal.merchant': 'zibal',
      'payment.zibal.callbackUrl': 'http://localhost:3000/v1/payments/zibal/callback',
      ...overrides,
    };

    svc = new PaymentsService(
      paymentsRepo as never,
      purchasesRepo as never,
      provider as never,
      { grantCreditsWithin: jest.fn() } as never,
      { get: jest.fn((key: string) => configured[key]) } as never,
      { transaction: jest.fn() } as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
    );
  };

  beforeEach(() => build());

  it('prices the purchase with the deployment credit price', async () => {
    const result = await svc.createPurchase('u-1', 250);

    expect(result).toMatchObject({
      purchaseId: 'pur-1',
      paymentId: 'pay-1',
      credits: 250,
      amountToman: 25_000,
      pricePerCreditToman: 100,
      trackId: '1000',
      paymentUrl: 'http://127.0.0.1:3010/start/1000',
    });
    expect(purchasesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u-1',
        credits: 250,
        pricePerCreditToman: 100,
        amountToman: 25_000,
        currency: 'IRT',
        status: 'PENDING',
        paymentId: null,
      }),
    );
  });

  it('sends the purchase id to the provider as the order reference', async () => {
    await svc.createPurchase('u-1', 250);

    expect(provider.createPayment).toHaveBeenCalledWith(
      expect.objectContaining({ amountToman: 25_000, orderId: 'pur-1' }),
    );
  });

  it('rejects zero, negative and fractional credit amounts', async () => {
    await expect(svc.createPurchase('u-1', 0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createPurchase('u-1', -5)).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createPurchase('u-1', 2.5)).rejects.toBeInstanceOf(BadRequestException);
    expect(purchasesRepo.save).not.toHaveBeenCalled();
  });

  it('rejects an amount above the ceiling before calling the provider', async () => {
    build(1000);

    await expect(svc.createPurchase('u-1', 1_000_000)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(provider.createPayment).not.toHaveBeenCalled();
    expect(purchasesRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to sell credits when payments are not configured', async () => {
    build(100, { 'payment.zibal.merchant': '' });

    const error = await svc.createPurchase('u-1', 10).catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getResponse()).toMatchObject({ code: 'payment_not_configured' });
    expect(purchasesRepo.save).not.toHaveBeenCalled();
  });

  it('refuses to sell credits when the callback url is not configured', async () => {
    build(100, { 'payment.zibal.callbackUrl': '' });

    const error = await svc.createPurchase('u-1', 10).catch((e) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(error.getResponse()).toMatchObject({ code: 'payment_not_configured' });
  });

  it('marks the purchase failed and reports 502 when the provider refuses', async () => {
    provider.createPayment.mockRejectedValue(new Error('payment_provider_error: -1'));

    await expect(svc.createPurchase('u-1', 10)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(purchasesRepo.update).toHaveBeenCalledWith(
      { id: 'pur-1' },
      expect.objectContaining({ status: 'FAILED' }),
    );
    expect(paymentsRepo.save).not.toHaveBeenCalled();
  });
});
