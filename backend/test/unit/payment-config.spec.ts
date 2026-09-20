import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import configuration from '../../src/config/configuration';
import { validateEnv } from '../../src/config/env.validation';

describe('payment configuration', () => {
  const BASE_ENV: Record<string, string> = {
    NODE_ENV: 'test',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '5432',
    POSTGRES_USER: 'postgres',
    POSTGRES_PASSWORD: 'postgres',
    POSTGRES_DB: 'chatbot_test',
    JWT_SECRET: 'integration-test-secret-with-enough-entropy-here',
    JWT_REFRESH_SECRET: 'integration-test-refresh-secret-entropy',
  };

  it('boots without any payment configuration so the feature can stay off', () => {
    const parsed = validateEnv({ ...BASE_ENV }) as unknown as Record<string, unknown>;

    expect(parsed.ZIBAL_BASE_URL).toBe('https://gateway.zibal.ir');
    expect(parsed.ZIBAL_TIMEOUT_MS).toBe(10_000);
    expect(parsed.ZIBAL_MERCHANT).toBe('');
    expect(parsed.PAYMENT_RESULT_REDIRECT_URL).toBe('');
  });

  it('rejects a redirect target that is not an absolute http(s) URL', () => {
    expect(() =>
      validateEnv({ ...BASE_ENV, PAYMENT_RESULT_REDIRECT_URL: '/checkout/result' }),
    ).toThrow(/PAYMENT_RESULT_REDIRECT_URL/);
  });

  it('rejects a callback URL that is not absolute', () => {
    expect(() => validateEnv({ ...BASE_ENV, ZIBAL_CALLBACK_URL: 'callback' })).toThrow(
      /ZIBAL_CALLBACK_URL/,
    );
  });

  it('rejects a non-numeric or too-small timeout', () => {
    expect(() => validateEnv({ ...BASE_ENV, ZIBAL_TIMEOUT_MS: 'soon' })).toThrow(
      /ZIBAL_TIMEOUT_MS/,
    );
    expect(() => validateEnv({ ...BASE_ENV, ZIBAL_TIMEOUT_MS: '10' })).toThrow(
      /ZIBAL_TIMEOUT_MS/,
    );
  });

  it('exposes the payment block through ConfigService', async () => {
    process.env.PAYMENT_RESULT_REDIRECT_URL = 'http://localhost:5173/checkout/result';
    process.env.ZIBAL_MERCHANT = 'zibal';
    process.env.ZIBAL_CALLBACK_URL = 'http://localhost:3000/v1/payments/zibal/callback';
    process.env.ZIBAL_BASE_URL = 'http://127.0.0.1:3010';
    process.env.ZIBAL_TIMEOUT_MS = '4000';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] })],
    }).compile();

    const cfg = moduleRef.get(ConfigService);

    expect(cfg.get('payment.resultRedirectUrl')).toBe('http://localhost:5173/checkout/result');
    expect(cfg.get('payment.zibal.baseUrl')).toBe('http://127.0.0.1:3010');
    expect(cfg.get('payment.zibal.callbackUrl')).toBe(
      'http://localhost:3000/v1/payments/zibal/callback',
    );
    expect(cfg.get('payment.zibal.merchant')).toBe('zibal');
    expect(cfg.get('payment.zibal.timeoutMs')).toBe(4000);
  });

  it('strips a trailing slash from the Zibal base URL', async () => {
    process.env.ZIBAL_BASE_URL = 'https://gateway.zibal.ir//';

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, load: [configuration] })],
    }).compile();

    expect(moduleRef.get(ConfigService).get('payment.zibal.baseUrl')).toBe(
      'https://gateway.zibal.ir',
    );
  });
});
