import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeZibalModule } from './fake-zibal.module';

describe('FakeZibal (request)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FakeZibalModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates a transaction and returns a numeric trackId', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/request')
      .send({ merchant: 'zibal', amount: 250_000, orderId: 'purchase-1' })
      .expect(200);

    expect(res.body.result).toBe(100);
    expect(typeof res.body.trackId).toBe('string');
    expect(res.body.trackId).toMatch(/^[0-9]+$/);
    expect(Number(res.body.trackId)).toBeGreaterThan(0);
  });

  it('rejects a non-integer amount', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/request')
      .send({ merchant: 'zibal', amount: 1.5 })
      .expect(200);

    expect(res.body.result).toBe(-1);
    expect(res.body.trackId).toBeUndefined();
  });

  it('issues monotonically increasing trackIds', async () => {
    const first = await request(app.getHttpServer())
      .post('/v1/request')
      .send({ merchant: 'zibal', amount: 10_000 })
      .expect(200);
    const second = await request(app.getHttpServer())
      .post('/v1/request')
      .send({ merchant: 'zibal', amount: 10_000 })
      .expect(200);

    expect(Number(second.body.trackId)).toBe(Number(first.body.trackId) + 1);
  });
});
