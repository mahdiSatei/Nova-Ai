import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeZibalModule } from './fake-zibal.module';

describe('FakeZibal (verify)', () => {
  let app: INestApplication;

  const newTransaction = async (amount = 250_000): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/v1/request')
      .send({
        merchant: 'zibal',
        amount,
        orderId: 'purchase-1',
        callbackUrl: 'http://localhost:3000/cb',
      })
      .expect(200);
    return res.body.trackId as string;
  };

  const setScenario = async (trackId: string, scenario: string): Promise<void> => {
    await request(app.getHttpServer())
      .put(`/__test__/transactions/${trackId}/scenario`)
      .send({ scenario })
      .expect(204);
  };

  const pay = async (trackId: string): Promise<void> => {
    await request(app.getHttpServer())
      .post(`/start/${trackId}/pay`)
      .type('form')
      .send({ outcome: 'success' })
      .expect(302);
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeZibalModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post('/__test__/reset').expect(204);
  });

  afterEach(async () => {
    await app.close();
  });

  it('verifies a paid transaction with result 100 and echoes the rial amount', async () => {
    const trackId = await newTransaction(250_000);
    await pay(trackId);

    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);

    expect(res.body.result).toBe(100);
    expect(res.body.amount).toBe(250_000);
    expect(typeof res.body.refNumber).toBe('string');
    expect(new Date(res.body.paidAt).toString()).not.toBe('Invalid Date');
  });

  it('returns 201 when the same transaction is verified twice', async () => {
    const trackId = await newTransaction();
    await pay(trackId);

    await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);

    expect(second.body.result).toBe(201);
  });

  it('returns 202 when the transaction was never paid', async () => {
    const trackId = await newTransaction();

    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);

    expect(res.body.result).toBe(202);
  });

  it('returns 203 for an unknown trackId', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId: '424242' })
      .expect(200);

    expect(res.body.result).toBe(203);
  });

  it('returns -1 when trackId is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal' })
      .expect(200);

    expect(res.body.result).toBe(-1);
  });

  it('returns 503 when the scenario is timeout', async () => {
    const trackId = await newTransaction();
    await setScenario(trackId, 'timeout');
    await pay(trackId);

    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);

    expect(res.body.result).toBe(503);
  });

  it('returns 500 with result -2 when the scenario is verify_unavailable', async () => {
    const trackId = await newTransaction();
    await setScenario(trackId, 'verify_unavailable');
    await pay(trackId);

    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(500);

    expect(res.body.result).toBe(-2);
  });

  it('returns a higher amount when the scenario is amount_mismatch', async () => {
    const trackId = await newTransaction(250_000);
    await setScenario(trackId, 'amount_mismatch');
    await pay(trackId);

    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);

    expect(res.body.result).toBe(100);
    expect(res.body.amount).toBe(260_000);
  });

  it('never marks a fail-scenario transaction as paid', async () => {
    const trackId = await newTransaction();
    await setScenario(trackId, 'fail');
    await pay(trackId);

    const res = await request(app.getHttpServer())
      .post('/v1/verify')
      .send({ merchant: 'zibal', trackId })
      .expect(200);

    expect(res.body.result).toBe(202);
  });
});
