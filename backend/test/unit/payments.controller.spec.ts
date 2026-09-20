import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { PaymentsController } from '../../src/modules/payments/payments.controller';
import { PaymentsService } from '../../src/modules/payments/payments.service';

describe('PaymentsController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;
  let config: { get: jest.Mock };

  const payment = {
    id: 'pay-1',
    purchaseId: 'pur-1',
    status: 'PENDING',
    provider: 'ZIBAL',
    amountToman: 25_000,
    trackId: '1000',
    reference: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    paidAt: null,
  };

  beforeEach(async () => {
    svc = {
      createPurchase: jest.fn(async () => ({
        purchaseId: 'pur-1',
        paymentId: 'pay-1',
        credits: 250,
        amountToman: 25_000,
        pricePerCreditToman: 100,
        trackId: '1000',
        paymentUrl: 'http://127.0.0.1:3010/start/1000',
      })),
      listPaymentsForUser: jest.fn(async () => ({ items: [payment], total: 1 })),
      getPaymentForUser: jest.fn(async () => payment),
      verifyAndFinalize: jest.fn(async () => ({ ...payment, status: 'SUCCESS' })),
    };
    config = { get: jest.fn(() => 'http://localhost:5173/checkout/result') };

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentsService, useValue: svc },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // The auth guard is registered globally in AppModule, which this focused
    // testing module does not load — stand in for it so `@CurrentUser()`
    // resolves. The real guard wiring (401s, and the `@Public()` callback) is
    // covered by the end-to-end suite in Task 12.
    app.useGlobalGuards({
      canActivate: (ctx: ExecutionContext) => {
        ctx.switchToHttp().getRequest().user = {
          id: 'u-1',
          email: 'u@example.com',
          role: 'user',
          jti: 'j',
        };
        return true;
      },
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a purchase for the authenticated user', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/credit-purchases')
      .send({ credits: 250 })
      .expect(201);

    expect(res.body.paymentUrl).toContain('/start/1000');
    expect(res.body.credits).toBe(250);
    expect(svc.createPurchase).toHaveBeenCalledWith('u-1', 250);
  });

  it('rejects a zero or fractional credit amount', async () => {
    await request(app.getHttpServer())
      .post('/v1/credit-purchases')
      .send({ credits: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/credit-purchases')
      .send({ credits: 1.5 })
      .expect(400);
    expect(svc.createPurchase).not.toHaveBeenCalled();
  });

  it("lists only the caller's payments", async () => {
    const res = await request(app.getHttpServer()).get('/v1/payments').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(1);
    expect(res.body.limit).toBe(20);
    expect(svc.listPaymentsForUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('passes a status filter through', async () => {
    await request(app.getHttpServer()).get('/v1/payments?status=SUCCESS').expect(200);

    expect(svc.listPaymentsForUser).toHaveBeenCalledWith(
      'u-1',
      expect.objectContaining({ status: 'SUCCESS' }),
    );
  });

  it('rejects an unknown status filter', async () => {
    await request(app.getHttpServer()).get('/v1/payments?status=BOGUS').expect(400);
  });

  it('reads a single payment for the caller', async () => {
    const res = await request(app.getHttpServer()).get('/v1/payments/pay-1').expect(200);

    expect(res.body.id).toBe('pay-1');
    expect(svc.getPaymentForUser).toHaveBeenCalledWith('u-1', 'pay-1');
  });

  it('redirects to the configured result url after a successful callback', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/payments/zibal/callback?trackId=1000&success=1')
      .expect(302);

    expect(res.headers.location).toBe(
      'http://localhost:5173/checkout/result?paymentId=pay-1&status=success',
    );
    expect(svc.verifyAndFinalize).toHaveBeenCalledWith('1000');
  });

  it('appends to a result url that already has a query string', async () => {
    config.get.mockReturnValue('http://localhost:5173/checkout/result?plan=pro');

    const res = await request(app.getHttpServer())
      .get('/v1/payments/zibal/callback?trackId=1000&success=1')
      .expect(302);

    expect(res.headers.location).toBe(
      'http://localhost:5173/checkout/result?plan=pro&paymentId=pay-1&status=success',
    );
  });

  it('redirects with not_found when the track id is unknown', async () => {
    svc.verifyAndFinalize.mockRejectedValue(new Error('nope'));

    const res = await request(app.getHttpServer())
      .get('/v1/payments/zibal/callback?trackId=424242&success=1')
      .expect(302);

    expect(res.headers.location).toContain('status=not_found');
  });

  it('redirects with pending when the provider is unreachable', async () => {
    svc.verifyAndFinalize.mockResolvedValue({ ...payment, status: 'PENDING' });

    const res = await request(app.getHttpServer())
      .get('/v1/payments/zibal/callback?trackId=1000&success=1')
      .expect(302);

    expect(res.headers.location).toContain('status=pending');
  });

  it('lets the verified status win over the callback query string', async () => {
    svc.verifyAndFinalize.mockResolvedValue({ ...payment, status: 'CANCELLED' });

    const res = await request(app.getHttpServer())
      .get('/v1/payments/zibal/callback?trackId=1000&success=1')
      .expect(302);

    expect(res.headers.location).toContain('status=cancelled');
  });

  it('rejects a callback without a trackId', async () => {
    await request(app.getHttpServer()).get('/v1/payments/zibal/callback?success=1').expect(400);
  });
});
