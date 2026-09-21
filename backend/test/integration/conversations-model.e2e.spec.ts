import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Model } from '../../src/modules/models/entities/model.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { randomUUID } from 'crypto';

/**
 * Integration test for PATCH /v1/conversations/:id/model.
 *
 * Mirrors the bootstrap from conversations.e2e.spec.ts (CentralProvider
 * seed, AppConfig default model pointer, two-user registration). Adds a
 * second enabled model + a disabled model so the switch-and-validate
 * paths can be exercised without depending on any other test file.
 */
describe('PATCH /v1/conversations/:id/model — e2e', () => {
  let app: INestApplication;
  let accessTokenA: string;
  let accessTokenB: string;

  // Seeds and users are run-scoped: `chatbot_test` is a shared, persistent
  // database, and `providers.name` is unique on PostgreSQL.
  const RUN = Date.now().toString(36);
  const PROVIDER_ID = `switch-prov-${RUN}`;
  const MODEL_A = randomUUID();
  const MODEL_B = randomUUID();
  const MODEL_DISABLED = randomUUID();
  const EMAIL_A = `switcher-a-${RUN}@example.com`;
  const EMAIL_B = `switcher-b-${RUN}@example.com`;
  const USER_A = `switch_a_${RUN}`;
  const USER_B = `switch_b_${RUN}`;

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

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Provider seed. Phase 2 replaced the `central_providers` singleton with
    // the multi-provider catalog, so models need a real `providers` row.
    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save(
      providerRepo.create({
        id: PROVIDER_ID,
        name: `Switch Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    );

    // Three models: two enabled for the success path, one disabled for
    // the negative path. Same shape as the existing e2e seed so the FK
    // constraint and the AppConfig default model pointer stay valid.
    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      modelRepo.create({ id: MODEL_A, displayName: `Model A ${RUN}`, actualName: `model-a-${RUN}`, providerId: PROVIDER_ID, visibility: 'public', enabled: true, isDefault: true }),
      modelRepo.create({ id: MODEL_B, displayName: `Model B ${RUN}`, actualName: `model-b-${RUN}`, providerId: PROVIDER_ID, visibility: 'public', enabled: true }),
      modelRepo.create({ id: MODEL_DISABLED, displayName: `Disabled ${RUN}`, actualName: `disabled-${RUN}`, providerId: PROVIDER_ID, visibility: 'public', enabled: false }),
    ]);

    const { AppConfig } = await import('../../src/modules/app-config/entities/app-config.entity');
    const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = MODEL_A;
      await ds.getRepository(AppConfig).save(cfg);
    }

    const regA = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ username: USER_A, email: EMAIL_A, password: 'correct-horse-battery-staple' });
    accessTokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ username: USER_B, email: EMAIL_B, password: 'correct-horse-battery-staple' });
    accessTokenB = regB.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function dsUserA(): Promise<{ id: string }> {
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [EMAIL_A]);
    return rows[0];
  }

  async function createConversationForA(): Promise<{ id: string }> {
    const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
    const conversations = app.get(ConversationsService);
    const conv = await conversations.create({
      userId: (await dsUserA()).id,
      modelId: MODEL_A,
      userMessage: 'seed',
    });
    return { id: conv.id };
  }

  it('updates Conversation.modelId for the owner with an enabled model', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: MODEL_B });
    expect(res.status).toBe(200);
    expect(res.body.modelId).toBe(MODEL_B);
    expect(res.body.modelDisplayName).toBe(`Model B ${RUN}`);
  });

  it('returns 403 when the caller is not the owner', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenB}`)
      .send({ modelId: MODEL_B });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('forbidden');
  });

  it('returns 404 when the conversation does not exist', async () => {
    const res = await request(app.getHttpServer())
      .patch('/v1/conversations/00000000-0000-4000-8000-000000000000/model')
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: MODEL_B });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('conversation_not_found');
  });

  it('returns 422 when the model is disabled', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: MODEL_DISABLED });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('model_unavailable');
  });

  it('returns 422 when the modelId is unknown', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({ modelId: '00000000-0000-4000-8000-000000000999' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('model_unavailable');
  });

  it('returns 400 when modelId is missing from the body', async () => {
    const { id } = await createConversationForA();
    const res = await request(app.getHttpServer())
      .patch(`/v1/conversations/${id}/model`)
      .set('Authorization', `Bearer ${accessTokenA}`)
      .send({});
    expect(res.status).toBe(400);
  });
});
