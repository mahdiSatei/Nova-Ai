import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeZibalModule } from './fake-zibal.module';

describe('FakeZibal (dev controls)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeZibalModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    await request(app.getHttpServer()).post('/__test__/reset').expect(204);
  });

  afterEach(async () => {
    await app.close();
  });

  const newTransaction = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/v1/request')
      .send({
        merchant: 'zibal',
        amount: 250_000,
        callbackUrl: 'http://127.0.0.1:1/unreachable',
      })
      .expect(200);
    return res.body.trackId as string;
  };

  it('inspects a transaction', async () => {
    const trackId = await newTransaction();

    const res = await request(app.getHttpServer())
      .get(`/__test__/transactions/${trackId}`)
      .expect(200);

    expect(res.body).toMatchObject({
      trackId,
      amountRial: 250_000,
      scenario: 'success',
      paid: false,
      verified: false,
      verifyCount: 0,
    });
  });

  it('rejects an unknown scenario', async () => {
    const trackId = await newTransaction();

    await request(app.getHttpServer())
      .put(`/__test__/transactions/${trackId}/scenario`)
      .send({ scenario: 'explode' })
      .expect(400);
  });

  it('404s on an unknown trackId', async () => {
    await request(app.getHttpServer()).get('/__test__/transactions/999999').expect(404);
  });

  it('clears transactions on reset', async () => {
    const trackId = await newTransaction();
    await request(app.getHttpServer()).post('/__test__/reset').expect(204);

    await request(app.getHttpServer()).get(`/__test__/transactions/${trackId}`).expect(404);
  });
});
