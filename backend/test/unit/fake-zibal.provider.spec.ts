import { ConfigService } from '@nestjs/config';
import { FakeZibalProvider } from '../../src/modules/payments/providers/fake-zibal.provider';

const config = (overrides: Record<string, unknown> = {}): ConfigService =>
  ({
    get: (key: string) => {
      const values: Record<string, unknown> = {
        'payment.zibal.baseUrl': 'http://127.0.0.1:3010',
        'payment.zibal.merchant': 'zibal',
        'payment.zibal.callbackUrl': 'http://localhost:3000/v1/payments/zibal/callback',
        'payment.zibal.timeoutMs': 5000,
        ...overrides,
      };
      return values[key];
    },
  }) as unknown as ConfigService;

describe('FakeZibalProvider', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('converts Toman to rial by multiplying by ten', () => {
    const provider = new FakeZibalProvider(config());
    expect(provider.toProviderAmount(250_000)).toBe(2_500_000);
  });

  it('refuses a non-integer Toman amount', () => {
    const provider = new FakeZibalProvider(config());
    expect(() => provider.toProviderAmount(10.5)).toThrow(/integer/);
  });

  it('requests a payment and returns a redirect url', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: 100, trackId: '1000' }),
    }) as unknown as typeof fetch;

    const provider = new FakeZibalProvider(config());
    const result = await provider.createPayment({
      amountToman: 250_000,
      orderId: 'purchase-1',
      description: '1000 credits',
    });

    expect(result).toEqual({
      trackId: '1000',
      providerAmountRial: 2_500_000,
      paymentUrl: 'http://127.0.0.1:3010/start/1000',
    });

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3010/v1/request');
    expect(JSON.parse(init.body as string)).toMatchObject({
      merchant: 'zibal',
      amount: 2_500_000,
      orderId: 'purchase-1',
      callbackUrl: 'http://localhost:3000/v1/payments/zibal/callback',
    });
  });

  it('throws when the request call fails with a non-100 result', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: -1, message: 'bad amount' }),
    }) as unknown as typeof fetch;

    const provider = new FakeZibalProvider(config());
    await expect(
      provider.createPayment({ amountToman: 250_000, orderId: 'purchase-1' }),
    ).rejects.toThrow(/payment_provider_error/);
  });

  it('maps every documented verify result code', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ result: 100, amount: 2_500_000, refNumber: '9001000' }, 'SUCCESS'],
      [{ result: 201, amount: 2_500_000 }, 'SUCCESS'],
      [{ result: 202 }, 'NOT_PAID'],
      [{ result: 203 }, 'INVALID_TRANSACTION'],
      [{ result: 503 }, 'PROVIDER_UNAVAILABLE'],
      [{ result: 999 }, 'INVALID_TRANSACTION'],
    ];

    for (const [payload, expected] of cases) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }) as unknown as typeof fetch;

      const provider = new FakeZibalProvider(config());
      const verification = await provider.verifyPayment('1000');
      expect(verification.status).toBe(expected);
    }
  });

  it('treats a network failure as PROVIDER_UNAVAILABLE without throwing', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;

    const provider = new FakeZibalProvider(config());
    const verification = await provider.verifyPayment('1000');

    expect(verification.status).toBe('PROVIDER_UNAVAILABLE');
    expect(verification.providerAmountRial).toBeNull();
  });

  it('treats an HTTP 500 carrying a result code as PROVIDER_UNAVAILABLE', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ result: -2, message: 'provider unavailable' }),
    }) as unknown as typeof fetch;

    const provider = new FakeZibalProvider(config());
    const verification = await provider.verifyPayment('1000');

    expect(verification.status).toBe('PROVIDER_UNAVAILABLE');
    expect(verification.raw).toMatchObject({ result: -2 });
  });

  it('treats a bare HTTP 500 as PROVIDER_UNAVAILABLE', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '<html>bad gateway</html>',
    }) as unknown as typeof fetch;

    const provider = new FakeZibalProvider(config());
    const verification = await provider.verifyPayment('1000');

    expect(verification.status).toBe('PROVIDER_UNAVAILABLE');
  });

  it('parses amount, reference and paidAt from a success verify', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          result: 100,
          amount: 2_500_000,
          refNumber: '9001000',
          paidAt: '2026-01-02T03:04:05.000Z',
        }),
    }) as unknown as typeof fetch;

    const provider = new FakeZibalProvider(config());
    const verification = await provider.verifyPayment('1000');

    expect(verification.providerAmountRial).toBe(2_500_000);
    expect(verification.reference).toBe('9001000');
    expect(verification.paidAt?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
  });
});
