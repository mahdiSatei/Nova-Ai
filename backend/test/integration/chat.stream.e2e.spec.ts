import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Model } from '../../src/modules/models/entities/model.entity';
import { CentralProvider } from '../../src/modules/provider/entities/central-provider.entity';
import { OpenAICompatibleClient } from '../../src/modules/chat/provider/openai-compatible.client';
import { decrypt, encrypt } from '../../src/common/crypto/credential-cipher';
import OpenAI from 'openai';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';

const providerMock = {
  yieldChunks: async function* (chunks: string[], delayMs: number) {
    for (const c of chunks) {
      await new Promise((r) => setTimeout(r, delayMs));
      yield { choices: [{ delta: { content: c } }] } as any;
    }
  },
};

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
  let serverBaseUrl: string;

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
    })
      .overrideProvider(OpenAICompatibleClient)
      .useValue({
        getClient: async () => new OpenAI({ baseURL: 'http://localhost:9999', apiKey: 'test-key' }),
        stream: async (_params: any) => providerMock.yieldChunks(['Hello', ' ', 'world'], 30),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    // Bind to a real port so we can issue raw http requests in the
    // disconnect-resilience test below (supertest buffers SSE streams,
    // which makes mid-stream disconnect impossible to drive with it).
    await app.listen(0);

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

    // ModelsService.resolveActiveModel reads AppConfig.default_model_id
    // (the source of truth for the admin-designated default), not the
    // Model.isDefault flag — so we update AppConfig here too. Without
    // this, the chat endpoint fails with no_model_available and never
    // creates the conversation under test.
    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = 'model-1';
      await appConfigRepo.save(cfg);
    }

    // Register + login. (username is required by RegisterRequestDto.)
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        username: 'chat_e2e_user',
        email: 'chat-e2e@example.com',
        password: 'correct-horse-battery-staple',
      });
    accessToken = reg.body.accessToken;

    // Capture the bound URL so the disconnect-resilience test can issue
    // raw http requests (supertest buffers SSE streams).
    const addr = (app.getHttpServer() as unknown as { address: () => { port: number } }).address();
    serverBaseUrl = `http://127.0.0.1:${addr.port}`;
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

  it('persists the FULL assistant response when the client disconnects mid-stream', async () => {
    // supertest buffers SSE responses and only delivers them when the
    // stream ends — which makes a mid-stream disconnect impossible to
    // drive with it. We issue a raw http.request against the bound
    // server, abort the socket as soon as the first delta arrives, then
    // wait for the server-side consume task to finish persisting.

    const url = new URL(`${serverBaseUrl}/v1/chat/stream`);
    const body = JSON.stringify({ message: 'Tell me a long story' });

    let firstDeltaResolve!: () => void;
    let firstDeltaReject!: (err: Error) => void;
    let firstWireChunk = '';
    const firstDelta = new Promise<void>((resolve, reject) => {
      firstDeltaResolve = resolve;
      firstDeltaReject = reject;
    });

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'text/event-stream',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.on('data', (buf: Buffer) => {
          const chunk = buf.toString('utf8');
          // Skip SseStream's leading blank line when picking the first
          // meaningful frame.
          if (!firstWireChunk && chunk.trim().length > 0) firstWireChunk = chunk;
          if (chunk.includes('"delta":"Hello"')) {
            firstDeltaResolve();
          }
        });
        res.on('error', () => {
          /* expected when we abort the request */
        });
      },
    );
    req.on('error', () => {
      /* expected when we abort the request */
    });

    const watchdog = setTimeout(
      () => firstDeltaReject(new Error('Timed out waiting for first delta')),
      5000,
    );

    req.write(body);

    await firstDelta;
    clearTimeout(watchdog);

    // Wire-format guard: Nest's SseStream serializes event names from the
    // `type` property. The FIRST frame on the wire must be a named `start`
    // event — if the service ever reverts to `event:` keys, frames go out
    // unnamed and the frontend silently drops ids/errors (real regression).
    expect(firstWireChunk).toContain('event: start');
    expect(firstWireChunk).toContain('"assistantMessageId"');

    // Force the underlying socket to close — simulates the user
    // closing the browser or navigating away.
    req.destroy();

    // Give the server enough time to consume the remaining two chunks
    // and persist the full response.
    await new Promise((r) => setTimeout(r, 300));

    // The most recent conversation must contain exactly one assistant
    // message whose content is the FULL provider output, not a
    // truncated version captured at the time of disconnect.
    const server = app.getHttpServer();
    const list = await request(server)
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(list.body.items.length).toBeGreaterThan(0);
    const conversationId = list.body.items[0].id;

    const detail = await request(server)
      .get(`/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const assistantMessages = detail.body.messages.filter((m: any) => m.role === 'assistant');
    expect(assistantMessages.length).toBe(1);
    expect(assistantMessages[0].content).toBe('Hello world');
  });

});
