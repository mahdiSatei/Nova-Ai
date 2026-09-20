import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { FakeZibalModule } from './fake-zibal.module';

describe('FakeZibal (payment page)', () => {
  let app: INestApplication;

  const newTransaction = async (callbackUrl: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post('/v1/request')
      .send({ merchant: 'zibal', amount: 250_000, orderId: 'purchase-1', callbackUrl })
      .expect(200);
    return res.body.trackId as string;
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FakeZibalModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves an HTML page with success and cancel actions', async () => {
    const trackId = await newTransaction('http://localhost:3000/v1/payments/zibal/callback');

    const res = await request(app.getHttpServer()).get(`/start/${trackId}`).expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(`/start/${trackId}/pay`);
    expect(res.text).toContain('data-outcome="success"');
    expect(res.text).toContain('data-outcome="cancel"');
  });

  it('returns 404 for an unknown trackId', async () => {
    await request(app.getHttpServer()).get('/start/999999').expect(404);
  });

  it('redirects to the callback url with success=1 after paying', async () => {
    const trackId = await newTransaction('http://localhost:3000/v1/payments/zibal/callback');

    const res = await request(app.getHttpServer())
      .post(`/start/${trackId}/pay`)
      .type('form')
      .send({ outcome: 'success' })
      .expect(302);

    expect(res.headers.location).toBe(
      `http://localhost:3000/v1/payments/zibal/callback?trackId=${trackId}&success=1`,
    );
  });

  it('redirects with success=0 when the user cancels', async () => {
    const trackId = await newTransaction('http://localhost:3000/v1/payments/zibal/callback');

    const res = await request(app.getHttpServer())
      .post(`/start/${trackId}/pay`)
      .type('form')
      .send({ outcome: 'cancel' })
      .expect(302);

    expect(res.headers.location).toContain(`trackId=${trackId}&success=0`);
  });

  it('preserves an existing query string on the callback url', async () => {
    const trackId = await newTransaction('http://localhost:3000/cb?plan=pro');

    const res = await request(app.getHttpServer())
      .post(`/start/${trackId}/pay`)
      .type('form')
      .send({ outcome: 'success' })
      .expect(302);

    expect(res.headers.location).toBe(
      `http://localhost:3000/cb?plan=pro&trackId=${trackId}&success=1`,
    );
  });

  it('rejects an unknown outcome', async () => {
    const trackId = await newTransaction('http://localhost:3000/v1/payments/zibal/callback');

    await request(app.getHttpServer())
      .post(`/start/${trackId}/pay`)
      .type('form')
      .send({ outcome: 'maybe' })
      .expect(400);
  });
});
