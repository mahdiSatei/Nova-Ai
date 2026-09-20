import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PaymentsAdminController } from '../../src/modules/payments/payments.admin.controller';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../../src/common/guards/roles.guard';

describe('PaymentsAdminController', () => {
  let app: INestApplication;
  let svc: Record<string, jest.Mock>;
  let role = 'admin';

  const USER_ID = '8f14e45f-ceea-467a-9d0a-1b2c3d4e5f60';
  const view = {
    id: 'pay-1',
    purchaseId: 'pur-1',
    status: 'SUCCESS',
    provider: 'ZIBAL',
    amountToman: 25_000,
    trackId: '1000',
    reference: '9001000',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    paidAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  beforeEach(async () => {
    role = 'admin';
    svc = {
      listPaymentsForAdmin: jest.fn(async () => ({ items: [view], total: 1 })),
      listPurchasesForAdmin: jest.fn(async () => ({
        items: [
          {
            id: 'pur-1',
            userId: USER_ID,
            credits: 250,
            amountToman: 25_000,
            pricePerCreditToman: 100,
            status: 'COMPLETED',
            paymentId: 'pay-1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            completedAt: new Date('2026-01-02T00:00:00.000Z'),
          },
        ],
        total: 1,
      })),
      reconcile: jest.fn(async () => view),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsAdminController],
      providers: [{ provide: PaymentsService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) => {
          ctx.switchToHttp().getRequest().user = {
            id: 'admin-1',
            email: 'admin@example.com',
            role,
            jti: 'j',
          };
          return true;
        },
      })
      .overrideGuard(RolesGuard)
      .useValue({
        canActivate: (ctx: ExecutionContext) =>
          ctx.switchToHttp().getRequest().user?.role === 'admin',
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('lists payments for an admin', async () => {
    const res = await request(app.getHttpServer()).get('/v1/admin/payments').expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.limit).toBe(20);
    expect(svc.listPaymentsForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, offset: 0 }),
    );
  });

  it('passes the status and user filters through', async () => {
    await request(app.getHttpServer())
      .get(`/v1/admin/payments?status=SUCCESS&userId=${USER_ID}`)
      .expect(200);

    expect(svc.listPaymentsForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'SUCCESS', userId: USER_ID }),
    );
  });

  it('rejects a non-uuid user filter', async () => {
    await request(app.getHttpServer()).get('/v1/admin/payments?userId=nope').expect(400);
  });

  it('accepts the purchase-only COMPLETED status on the purchases list', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/credit-purchases?status=COMPLETED')
      .expect(200);

    expect(svc.listPurchasesForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED' }),
    );
  });

  it('rejects COMPLETED on the payments list', async () => {
    await request(app.getHttpServer()).get('/v1/admin/payments?status=COMPLETED').expect(400);
  });

  it('lists credit purchases for an admin', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/admin/credit-purchases')
      .expect(200);

    expect(res.body.items[0]).toMatchObject({ id: 'pur-1', credits: 250 });
  });

  it('reconciles a payment', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/payments/pay-1/reconcile')
      .expect(200);

    expect(res.body.status).toBe('SUCCESS');
    expect(svc.reconcile).toHaveBeenCalledWith('pay-1');
  });

  it('forbids a non-admin token', async () => {
    role = 'user';

    await request(app.getHttpServer()).get('/v1/admin/payments').expect(403);
    expect(svc.listPaymentsForAdmin).not.toHaveBeenCalled();
  });
});
