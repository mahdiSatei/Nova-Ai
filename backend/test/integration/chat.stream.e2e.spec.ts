import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import * as http from 'http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { Model } from '../../src/modules/models/entities/model.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';
import OpenAI from 'openai';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';

// `models.id` is a real uuid column on PostgreSQL.
const MODEL_ID = randomUUID();

// Ids are run-scoped because these suites share the persistent `chatbot_test`
// database and `providers.name` is unique.
const RUN = Date.now().toString(36);
const PROVIDER_ID = `chat-prov-${RUN}`;

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
 * provider runtime is overridden to use a fake stream generator.
 */
describe('Chat stream — e2e', () => {
  let app: INestApplication;
  let accessToken: string;
  let serverBaseUrl: string;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT =
      process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD =
      process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET =
      'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET =
      'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY =
      Buffer.alloc(32, 1).toString('base64');

    // Phase 2 replaced the old single-method provider surface with
    // `assertReady` + `stream`, so the fake runtime must implement both —
    // otherwise the chat service streams `undefined`.
    const fakeConnection = {
      provider: {
        id: 'fake-provider',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
      } as Provider,
      adapter: {
        stream: async () =>
          providerMock.yieldChunks(['Hello', ' ', 'world'], 30),
      },
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderRuntimeService)
      .useValue({
        assertReady: jest.fn().mockResolvedValue(fakeConnection),
        stream: jest.fn(
          (connection: typeof fakeConnection) =>
            connection.adapter.stream(),
        ),
      })
      .compile();

    app = moduleRef.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );

    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    await app.listen(0);

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Seed provider + model.
    const providerRepo = ds.getRepository(Provider);

    await providerRepo.save(
      providerRepo.create({
        id: PROVIDER_ID,
        name: `Chat Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    );

    const modelRepo = ds.getRepository(Model);

    await modelRepo.save(
      modelRepo.create({
        id: MODEL_ID,
        displayName: `Chat Model ${RUN}`,
        actualName: `chat-model-${RUN}`,
        providerId: PROVIDER_ID,
        visibility: 'public',
        enabled: true,
      }),
    );

    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({
      where: { id: 'singleton' },
    });

    if (cfg) {
      cfg.defaultModelId = MODEL_ID;
      await appConfigRepo.save(cfg);
    }

    // Register + login.
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        username: `chat_${RUN}`,
        email: `chat-e2e-${RUN}@example.com`,
        password: 'correct-horse-battery-staple',
      });

    accessToken = reg.body.accessToken;

    const addr = (
      app.getHttpServer() as unknown as {
        address: () => { port: number };
      }
    ).address();

    serverBaseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it(
    'POST /v1/chat/stream — returns 200 with text/event-stream content-type',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Accept', 'text/event-stream')
        .send({ message: 'Hello' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    },
  );

  it(
    'POST /v1/chat/stream — rejects unauthenticated requests with 401',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .send({ message: 'Hello' });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_token');
    },
  );

  it(
    'POST /v1/chat/stream — accepts explicit null conversationId (new-chat payload shape from the frontend)',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Accept', 'text/event-stream')
        .send({
          conversationId: null,
          message: 'یک توضیح کوتاه از هوش مصنوعی بده.',
          modelId: MODEL_ID,
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
      expect(res.text ?? '').not.toMatch(/Bad Request/);
    },
  );

  it(
    'POST /v1/chat/stream — accepts the connection and returns SSE headers for valid input',
    async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Accept', 'text/event-stream')
        .send({ message: 'Valid message here' });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    },
  );

  it(
    'persists the FULL assistant response when the client disconnects mid-stream',
    async () => {
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
            if (!firstWireChunk && chunk.trim().length > 0) {
              firstWireChunk = chunk;
            }

            if (chunk.includes('"delta":"Hello"')) {
              firstDeltaResolve();
            }
          });

          res.on('error', () => {
            // expected when we abort the request
          });
        },
      );

      req.on('error', () => {
        // expected when we abort the request
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

      await new Promise((r) => setTimeout(r, 300));

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

      const assistantMessages = detail.body.messages.filter(
        (m: any) => m.role === 'assistant',
      );

      expect(assistantMessages.length).toBe(1);
      expect(assistantMessages[0].content).toBe('Hello world');
    },
  );
});