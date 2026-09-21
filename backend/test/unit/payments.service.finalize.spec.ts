import { NotFoundException } from '@nestjs/common';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { CreditPurchase } from '../../src/modules/payments/entities/credit-purchase.entity';
import { Payment } from '../../src/modules/payments/entities/payment.entity';
import type { ProviderVerification } from '../../src/modules/payments/payment-provider.interface';

describe('PaymentsService.verifyAndFinalize', () => {
  let paymentsRepo: Record<string, jest.Mock>;
  let purchasesRepo: Record<string, jest.Mock>;
  let provider: { name: string; verifyPayment: jest.Mock };
  let wallet: { grantCreditsWithin: jest.Mock };
  let manager: {
    query: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let svc: PaymentsService;

  const existingPayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    creditPurchaseId: 'pur-1',
    userId: 'u-1',
    provider: 'ZIBAL',
    status: 'PENDING',
    amountToman: 25_000,
    providerAmountRial: '250000',
    providerTrackId: '1000',
    ...overrides,
  });

  const verification = (
    overrides: Partial<ProviderVerification> = {},
  ): ProviderVerification => ({
    status: 'SUCCESS',
    providerAmountRial: 250_000,
    reference: '9001000',
    paidAt: new Date('2026-01-02T03:04:05.000Z'),
    raw: { result: 100 },
    ...overrides,
  });

  const build = (guardAffects = 1) => {
    paymentsRepo = { findOne: jest.fn(), update: jest.fn(), query: jest.fn(async () => []) };
    purchasesRepo = { findOne: jest.fn(), update: jest.fn() };
    provider = { name: 'ZIBAL', verifyPayment: jest.fn(async () => verification()) };
    wallet = { grantCreditsWithin: jest.fn(async () => ({})) };
    manager = {
      query: jest.fn(async (sql: string) =>
        sql.includes('UPDATE payments') && guardAffects === 1 ? [{ id: 'pay-1' }] : [],
      ),
      findOne: jest.fn(async (entity: unknown) =>
        entity === Payment
          ? existingPayment({ status: 'SUCCESS' })
          : { id: 'pur-1', credits: 250, status: 'PENDING' },
      ),
      update: jest.fn(async () => ({ affected: 1 })),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(manager)),
    };

    svc = new PaymentsService(
      paymentsRepo as never,
      purchasesRepo as never,
      provider as never,
      wallet as never,
      { get: jest.fn() } as never,
      dataSource as never,
      { log: jest.fn().mockResolvedValue(undefined) } as never,
    );
  };

  beforeEach(() => build());

  it('404s on an unknown track id', async () => {
    paymentsRepo.findOne.mockResolvedValue(null);

    await expect(svc.verifyAndFinalize('999')).rejects.toBeInstanceOf(NotFoundException);
    expect(provider.verifyPayment).not.toHaveBeenCalled();
  });

  it('does not touch the provider or the wallet for a terminal payment', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment({ status: 'SUCCESS' }));

    const result = await svc.verifyAndFinalize('1000');

    expect(result.status).toBe('SUCCESS');
    expect(provider.verifyPayment).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('grants credits and completes the purchase on success', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment());

    await svc.verifyAndFinalize('1000');

    expect(wallet.grantCreditsWithin).toHaveBeenCalledWith(manager, 'u-1', 250);
    expect(manager.update).toHaveBeenCalledWith(
      CreditPurchase,
      { id: 'pur-1' },
      expect.objectContaining({ status: 'COMPLETED' }),
    );
    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WHERE id = $1 AND status = 'PENDING'");
    expect(params[0]).toBe('pay-1');
    expect(params[1]).toBe('SUCCESS');
  });

  it('records the provider reference and paidAt on success', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment());

    await svc.verifyAndFinalize('1000');

    const [, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(params[3]).toBe('9001000');
    expect(params[5]).toEqual(new Date('2026-01-02T03:04:05.000Z'));
  });

  it('cancels the payment and purchase when the provider says not paid', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment());
    provider.verifyPayment.mockResolvedValue(
      verification({ status: 'NOT_PAID', providerAmountRial: null }),
    );

    await svc.verifyAndFinalize('1000');

    expect(wallet.grantCreditsWithin).not.toHaveBeenCalled();
    expect(manager.update).toHaveBeenCalledWith(
      CreditPurchase,
      { id: 'pur-1' },
      expect.objectContaining({ status: 'CANCELLED' }),
    );
  });

  it('fails the payment when the track id is invalid at the provider', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment());
    provider.verifyPayment.mockResolvedValue(
      verification({ status: 'INVALID_TRANSACTION', providerAmountRial: null }),
    );

    await svc.verifyAndFinalize('1000');

    expect(wallet.grantCreditsWithin).not.toHaveBeenCalled();
    const [, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe('FAILED');
    expect(manager.update).toHaveBeenCalledWith(
      CreditPurchase,
      { id: 'pur-1' },
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('fails and grants nothing when the paid amount differs', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment());
    provider.verifyPayment.mockResolvedValue(
      verification({ providerAmountRial: 260_000 }),
    );

    await svc.verifyAndFinalize('1000');

    expect(wallet.grantCreditsWithin).not.toHaveBeenCalled();
    const [, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe('FAILED');
  });

  it('accepts a matching amount given as a bigint string', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment({ providerAmountRial: '250000' }));
    provider.verifyPayment.mockResolvedValue(verification({ providerAmountRial: 250_000 }));

    await svc.verifyAndFinalize('1000');

    expect(wallet.grantCreditsWithin).toHaveBeenCalled();
  });

  it('leaves the payment pending and records the attempt when the provider is unavailable', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment());
    provider.verifyPayment.mockResolvedValue(
      verification({
        status: 'PROVIDER_UNAVAILABLE',
        providerAmountRial: null,
        raw: { result: 503 },
      }),
    );

    const result = await svc.verifyAndFinalize('1000');

    expect(result.status).toBe('PENDING');
    expect(paymentsRepo.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE payments'),
      ['pay-1', '503', JSON.stringify({ result: 503 })],
    );
    expect(wallet.grantCreditsWithin).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('grants nothing when another writer already finalized the payment', async () => {
    build(0);
    paymentsRepo.findOne.mockResolvedValue(existingPayment());

    const result = await svc.verifyAndFinalize('1000');

    expect(wallet.grantCreditsWithin).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(result.status).toBe('SUCCESS');
  });

  it('reconcile returns a terminal payment without re-verifying', async () => {
    paymentsRepo.findOne.mockResolvedValue(existingPayment({ status: 'FAILED' }));

    const result = await svc.reconcile('pay-1');

    expect(result.status).toBe('FAILED');
    expect(provider.verifyPayment).not.toHaveBeenCalled();
  });

  it('reconcile re-verifies a pending payment', async () => {
    paymentsRepo.findOne.mockResolvedValueOnce(existingPayment());
    paymentsRepo.findOne.mockResolvedValueOnce(existingPayment());

    await svc.reconcile('pay-1');

    expect(provider.verifyPayment).toHaveBeenCalledWith('1000');
    expect(wallet.grantCreditsWithin).toHaveBeenCalled();
  });

  it('reconcile 404s on an unknown payment id', async () => {
    paymentsRepo.findOne.mockResolvedValue(null);

    await expect(svc.reconcile('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
