import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { Model } from '../../src/modules/models/entities/model.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import { WEB_SEARCH_PROVIDER } from '../../src/modules/web-search/web-search-provider.interface';

const MODEL_ID = randomUUID();
const RUN = Date.now().toString(36);
const PROVIDER_ID = `websearch-prov-${RUN}`;

/**
 * E2E for the Phase 7 web-search streaming contract. The chat runtime yields a
 * web_search tool call first, then the grounded answer; the search provider is
 * a fake so the suite never touches the Serpex API.
 */
describe('Web search — e2e', () => {
  let app: INestApplication;
  let accessToken: string;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD = process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    const toolCallChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: 'call_1',
                type: 'function',
                function: { name: 'web_search', arguments: '{"query":"cats"}' },
              },
            ],
          },
        },
      ],
    };
    const textChunk = { choices: [{ delta: { content: 'Cats are great [S1].' } }] };
    let calls = 0;

    const fakeConnection = {
      provider: {
        id: 'fake-provider',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
      } as Provider,
      adapter: {},
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ProviderRuntimeService)
      .useValue({
        assertReady: jest.fn().mockResolvedValue(fakeConnection),
        stream: jest.fn(async () => {
          calls += 1;
          if (calls === 1) {
            return (async function* () {
              yield toolCallChunk;
            })();
          }
          return (async function* () {
            yield textChunk;
          })();
        }),
      })
      .overrideProvider(WEB_SEARCH_PROVIDER)
      .useValue({
        name: 'fake',
        search: jest.fn().mockResolvedValue({
          query: 'cats',
          fromCache: false,
          status: 'success',
          results: [
            { title: 'Cats', url: 'https://cats.test', snippet: 'meow', position: 1, content: 'cat facts' },
          ],
        }),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    await app.listen(0);

    const ds = app.get(DataSource);
    await ds.runMigrations();

    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save(
      providerRepo.create({
        id: PROVIDER_ID,
        name: `Web Search Provider ${RUN}`,
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
        displayName: `Web Search Model ${RUN}`,
        actualName: `websearch-model-${RUN}`,
        providerId: PROVIDER_ID,
        visibility: 'public',
        enabled: true,
      }),
    );

    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = MODEL_ID;
      await appConfigRepo.save(cfg);
    }

    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        username: `websearch_${RUN}`,
        email: `websearch-e2e-${RUN}@example.com`,
        password: 'correct-horse-battery-staple',
      });
    accessToken = reg.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('streams search lifecycle + citations and persists them', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'tell me about cats', modelId: MODEL_ID, webSearch: true });

    expect(res.status).toBe(200);
    const body = res.text ?? '';
    expect(body).toContain('"phase":"search_started"');
    expect(body).toContain('"phase":"search_completed"');
    expect(body).toContain('"phase":"retrieval_completed"');
    expect(body).toContain('event: citations');
    expect(body).toContain('https://cats.test');
    expect(body).toContain('event: done');

    const list = await request(app.getHttpServer())
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const conversationId = list.body.items[0].id;

    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const assistant = detail.body.messages.filter((m: { role: string }) => m.role === 'assistant').at(-1);
    expect(assistant.citations).toEqual([
      { id: 'S1', title: 'Cats', url: 'https://cats.test', snippet: 'meow' },
    ]);
  });
});
