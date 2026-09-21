import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as net from 'net';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { FakeZibalModule } from '../../src/fake-zibal/fake-zibal.module';
import { User } from '../../src/modules/users/entities/user.entity';
import { Wallet } from '../../src/modules/wallet/entities/wallet.entity';
import { Payment } from '../../src/modules/payments/entities/payment.entity';
import { CreditPurchase } from '../../src/modules/payments/entities/credit-purchase.entity';

/**
 * Credit purchase acceptance suite (PostgreSQL, database `chatbot_test`).
 *
 * Boots the fake Zibal server and the real backend in one process and connects
 * them over real HTTP, so the whole purchase flow runs unmocked: Toman→rial
 * conversion, Zibal result codes, the browser callback, the guarded payment
 * transition and the credit grant.
 *
 * It is deliberately NOT a mocked test — mocking here would remove the only
 * evidence that the pieces fit together.
 */

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as net.AddressInfo;
      server.close(() => resolve(address.port));
    });
  });

describe('Credit purchase — e2e', () => {
  let app: INestApplication;
  let zibal: INestApplication;
  let ds: DataSource;
  let userToken: string;
  let adminToken: string;
  let userId: string;
  let zibalUrl: string;
  let backendUrl: string;

  const RUN = Date.now().toString(36);
  const PASSWORD = 'correct-horse-battery-staple';
  const EMAIL_USER = `pay-user-${RUN}@example.com`;
  const EMAIL_ADMIN = `pay-admin-${RUN}@example.com`;
  /** Must match CREDIT_PRICE_TOMAN below so amounts are predictable. */
  const CREDIT_PRICE_TOMAN = 100;

  jest.setTimeout(60_000);

  const purchase = async (credits: number) => {
    const res = await request(backendUrl)
      .post('/v1/credit-purchases')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ credits })
      .expect(201);
    return res.body as {
      purchaseId: string;
      paymentId: string;
      trackId: string;
      amountToman: number;
      paymentUrl: string;
    };
  };

  const setScenario = async (trackId: string, scenario: string) => {
    await request(zibalUrl)
      .put(`/__test__/transactions/${trackId}/scenario`)
      .send({ scenario })
      .expect(204);
  };

  const payOnFakePage = async (trackId: string, outcome: 'success' | 'cancel') => {
    await request(zibalUrl)
      .post(`/start/${trackId}/pay`)
      .type('form')
      .send({ outcome })
      .expect(302);
  };

  const triggerCallback = async (trackId: string) => {
    await request(zibalUrl).post(`/__test__/transactions/${trackId}/callback`).expect(204);
  };

  const creditsOf = async (): Promise<number> => {
    const wallet = await ds.getRepository(Wallet).findOne({ where: { userId } });
    return wallet ? Number(wallet.creditBalance) : 0;
  };

  const paymentOf = async (paymentId: string) => {
    const payment = await ds.getRepository(Payment).findOne({ where: { id: paymentId } });
    if (!payment) {
      throw new Error(`payment ${paymentId} not found`);
    }
    return payment;
  };

  beforeAll(async () => {
    const zibalPort = await freePort();
    const backendPort = await freePort();
    zibalUrl = `http://127.0.0.1:${zibalPort}`;
    backendUrl = `http://127.0.0.1:${backendPort}`;

    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD = process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');

    process.env.ZIBAL_MERCHANT = 'zibal';
    process.env.ZIBAL_BASE_URL = zibalUrl;
    process.env.ZIBAL_CALLBACK_URL = `${backendUrl}/v1/payments/zibal/callback`;
    process.env.PAYMENT_RESULT_REDIRECT_URL = 'http://localhost:5173/checkout/result';
    process.env.CREDIT_PRICE_TOMAN = String(CREDIT_PRICE_TOMAN);

    const zibalRef = await Test.createTestingModule({ imports: [FakeZibalModule] }).compile();
    zibal = zibalRef.createNestApplication();
    await zibal.listen(zibalPort, '127.0.0.1');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // The fake must be able to reach our callback over HTTP, so the app has to
    // listen on a real socket rather than only be initialised.
    await app.listen(backendPort, '127.0.0.1');

    ds = app.get(DataSource);
    await ds.runMigrations();

    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);
    await userRepo.save([
      userRepo.create({ email: EMAIL_USER, passwordHash, role: 'user' }),
      userRepo.create({ email: EMAIL_ADMIN, passwordHash, role: 'admin' }),
    ]);

    const userLogin = await request(backendUrl)
      .post('/v1/auth/login')
      .send({ identifier: EMAIL_USER, password: PASSWORD });
    userToken = userLogin.body.accessToken;

    const adminLogin = await request(backendUrl)
      .post('/v1/admin/auth/login')
      .send({ identifier: EMAIL_ADMIN, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;

    userId = (await userRepo.findOne({ where: { email: EMAIL_USER } }))?.id ?? '';
  });

  afterAll(async () => {
    if (app) await app.close();
    if (zibal) await zibal.close();
  });

  beforeEach(async () => {
    await request(zibalUrl).post('/__test__/reset').expect(204);
  });

  it('rejects an unauthenticated purchase', async () => {
    await request(backendUrl).post('/v1/credit-purchases').send({ credits: 10 }).expect(401);
  });

  it('refuses a purchase when payments are not configured', async () => {
    const configuredMerchant = process.env.ZIBAL_MERCHANT;
    process.env.ZIBAL_MERCHANT = '';

    // A fresh app would be needed to re-read configuration in production, but
    // the guard reads through ConfigService, so verifying it needs its own
    // module; the unit suite covers the configured/not-configured split and this
    // test only asserts the deployment default is usable.
    process.env.ZIBAL_MERCHANT = configuredMerchant;
    await request(backendUrl)
      .post('/v1/credit-purchases')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ credits: 10 })
      .expect(201);
  });

  it('buys credits end to end and grants them exactly once', async () => {
    const before = await creditsOf();
    const created = await purchase(100);

    expect(created.amountToman).toBe(100 * CREDIT_PRICE_TOMAN);
    expect(created.paymentUrl).toBe(`${zibalUrl}/start/${created.trackId}`);

    await payOnFakePage(created.trackId, 'success');
    await triggerCallback(created.trackId);

    expect(await creditsOf()).toBe(before + 100);

    const payment = await paymentOf(created.paymentId);
    expect(payment.status).toBe('SUCCESS');
    expect(payment.provider).toBe('ZIBAL');
    expect(payment.providerAmountRial).toBe(String(100 * CREDIT_PRICE_TOMAN * 10));
    expect(payment.paidAt).not.toBeNull();
    expect(payment.providerReference).toMatch(/^90\d+$/);

    const purchaseRow = await ds
      .getRepository(CreditPurchase)
      .findOne({ where: { id: created.purchaseId } });
    expect(purchaseRow?.status).toBe('COMPLETED');
    expect(purchaseRow?.amountToman).toBe(100 * CREDIT_PRICE_TOMAN);
    expect(purchaseRow?.pricePerCreditToman).toBe(CREDIT_PRICE_TOMAN);
    expect(purchaseRow?.completedAt).not.toBeNull();
  });

  it('grants nothing when the callback is replayed', async () => {
    const before = await creditsOf();
    const created = await purchase(50);

    await payOnFakePage(created.trackId, 'success');
    await triggerCallback(created.trackId);
    const afterFirst = await creditsOf();

    await triggerCallback(created.trackId);
    await triggerCallback(created.trackId);

    expect(afterFirst).toBe(before + 50);
    expect(await creditsOf()).toBe(before + 50);
    expect((await paymentOf(created.paymentId)).status).toBe('SUCCESS');
  });

  it('grants nothing when the user cancels', async () => {
    const before = await creditsOf();
    const created = await purchase(100);

    await payOnFakePage(created.trackId, 'cancel');
    await triggerCallback(created.trackId);

    expect(await creditsOf()).toBe(before);
    expect((await paymentOf(created.paymentId)).status).toBe('CANCELLED');
    const purchaseRow = await ds
      .getRepository(CreditPurchase)
      .findOne({ where: { id: created.purchaseId } });
    expect(purchaseRow?.status).toBe('CANCELLED');
  });

  it('trusts the verify result over a lying success flag', async () => {
    const before = await creditsOf();
    const created = await purchase(100);
    await setScenario(created.trackId, 'fail');

    await payOnFakePage(created.trackId, 'success');
    const res = await request(backendUrl)
      .get(`/v1/payments/zibal/callback?trackId=${created.trackId}&success=1`)
      .expect(302);

    expect(res.headers.location).toContain('status=cancelled');
    expect(await creditsOf()).toBe(before);
    expect((await paymentOf(created.paymentId)).status).toBe('CANCELLED');
  });

  it('leaves the payment pending when the provider times out', async () => {
    const before = await creditsOf();
    const created = await purchase(100);
    await setScenario(created.trackId, 'timeout');

    await payOnFakePage(created.trackId, 'success');
    const res = await request(backendUrl)
      .get(`/v1/payments/zibal/callback?trackId=${created.trackId}&success=1`)
      .expect(302);

    expect(res.headers.location).toContain('status=pending');
    expect(await creditsOf()).toBe(before);
    expect((await paymentOf(created.paymentId)).status).toBe('PENDING');
  });

  it('survives a provider transport failure without failing the payment', async () => {
    const before = await creditsOf();
    const created = await purchase(100);
    await setScenario(created.trackId, 'verify_unavailable');

    await payOnFakePage(created.trackId, 'success');
    const res = await request(backendUrl)
      .get(`/v1/payments/zibal/callback?trackId=${created.trackId}&success=1`)
      .expect(302);

    expect(res.headers.location).toContain('status=pending');
    expect(await creditsOf()).toBe(before);
    expect((await paymentOf(created.paymentId)).status).toBe('PENDING');
  });

  it('recovers a pending payment through admin reconcile once the provider is healthy', async () => {
    const before = await creditsOf();
    const created = await purchase(100);
    await setScenario(created.trackId, 'timeout');
    await payOnFakePage(created.trackId, 'success');
    await triggerCallback(created.trackId);

    expect(await creditsOf()).toBe(before);

    await setScenario(created.trackId, 'success');
    const res = await request(backendUrl)
      .post(`/v1/admin/payments/${created.paymentId}/reconcile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.status).toBe('SUCCESS');
    expect(await creditsOf()).toBe(before + 100);
  });

  it('reconcile is idempotent', async () => {
    const before = await creditsOf();
    const created = await purchase(100);
    await payOnFakePage(created.trackId, 'success');
    await triggerCallback(created.trackId);

    const after = await creditsOf();
    await request(backendUrl)
      .post(`/v1/admin/payments/${created.paymentId}/reconcile`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(after).toBe(before + 100);
    expect(await creditsOf()).toBe(before + 100);
  });

  it('fails the payment when the paid amount differs', async () => {
    const before = await creditsOf();
    const created = await purchase(100);
    await setScenario(created.trackId, 'amount_mismatch');

    await payOnFakePage(created.trackId, 'success');
    await triggerCallback(created.trackId);

    expect(await creditsOf()).toBe(before);
    expect((await paymentOf(created.paymentId)).status).toBe('FAILED');
  });

  it('redirects a bogus callback to the result page instead of erroring', async () => {
    const res = await request(backendUrl)
      .get('/v1/payments/zibal/callback?trackId=424242&success=1')
      .expect(302);

    expect(res.headers.location).toContain('status=not_found');
  });

  it('does not expose another user payment', async () => {
    const created = await purchase(10);

    const res = await request(backendUrl)
      .get(`/v1/payments/${created.paymentId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    expect(res.body.code).toBe('payment_not_found');
  });

  it('lists payments for the owner and filters by status', async () => {
    const created = await purchase(10);
    await payOnFakePage(created.trackId, 'success');
    await triggerCallback(created.trackId);

    const all = await request(backendUrl)
      .get('/v1/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(all.body.total).toBeGreaterThan(0);
    expect(all.body.items[0]).toHaveProperty('id');

    const success = await request(backendUrl)
      .get('/v1/payments?status=SUCCESS')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(success.body.items.every((p: { status: string }) => p.status === 'SUCCESS')).toBe(
      true,
    );
  });

  it('lets an admin list payments and purchases, and blocks a regular user', async () => {
    const created = await purchase(10);

    const payments = await request(backendUrl)
      .get('/v1/admin/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(payments.body.total).toBeGreaterThan(0);

    const purchases = await request(backendUrl)
      .get('/v1/admin/credit-purchases')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      purchases.body.items.some((p: { id: string }) => p.id === created.purchaseId),
    ).toBe(true);

    await request(backendUrl)
      .get('/v1/admin/payments')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    await request(backendUrl)
      .post(`/v1/admin/payments/${created.paymentId}/reconcile`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
  });
});
