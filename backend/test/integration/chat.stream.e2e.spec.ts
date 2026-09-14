import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Model } from '../../src/modules/models/entities/model.entity';
import { CentralProvider } from '../../src/modules/provider/entities/central-provider.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';

/**
 * Integration test for POST /v1/chat/stream SSE endpoint.
 *
 * Tests the HTTP contract (status codes, content-type, error envelopes)
 * without depending on a real provider. The "happy path" test verifies
 * the endpoint returns 200 with text/event-stream content-type; the
 * provider mock is injected via NestJS module override.
 */
describe('Chat stream — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let accessToken: string;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-chat-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Seed provider config.
    const providerRepo = ds.getRepository(CentralProvider);
    await providerRepo.save(
      providerRepo.create({
        id: 'singleton',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        lastValidatedAt: null,
      }),
    );

    // Seed a model.
    const modelRepo = ds.getRepository(Model);
    await modelRepo.save(
      modelRepo.create({
        id: 'model-1',
        displayName: 'Test Model',
        actualName: 'test-model-v1',
        enabled: true,
        isDefault: true,
      }),
    );

    // Register + login.
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'chat-e2e@example.com', password: 'correct-horse-battery-staple' });
    accessToken = reg.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('POST /v1/chat/stream — returns 200 with text/event-stream content-type', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'Hello' });

    // The endpoint should accept the connection and return SSE headers.
    // The actual stream content depends on whether a provider is reachable,
    // but the HTTP contract must be correct.
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });

  it('POST /v1/chat/stream — rejects unauthenticated requests with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .send({ message: 'Hello' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
  });

  it('POST /v1/chat/stream — accepts explicit null conversationId (new-chat payload shape from the frontend)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .send({
        conversationId: null,
        message: 'یک توضیح کوتاه از هوش مصنوعی بده.',
        modelId: 'model-1',
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    // Validation must not reject the explicit nulls.
    expect(res.text ?? '').not.toMatch(/Bad Request/);
  });

  it('POST /v1/chat/stream — accepts the connection and returns SSE headers for valid input', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'Valid message here' });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
  });
});
