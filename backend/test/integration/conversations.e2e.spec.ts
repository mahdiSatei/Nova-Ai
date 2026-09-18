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
 * Integration test for conversations CRUD endpoints.
 *
 * Tests the full HTTP contract: list, get detail, delete.
 * Chat streaming is mocked so no real provider is needed.
 */
describe('Conversations — e2e', () => {
  let app: INestApplication;
  let accessTokenA: string; // user A
  let accessTokenB: string; // user B

  // Seeds and users are run-scoped: `chatbot_test` is a shared, persistent
  // database, and `providers.name` is unique on PostgreSQL.
  const RUN = Date.now().toString(36);
  const PROVIDER_ID = `convs-prov-${RUN}`;
  const MODEL_ID = randomUUID();
  const EMAIL_A = `user-a-${RUN}@example.com`;
  const EMAIL_B = `user-b-${RUN}@example.com`;
  const USER_A = `user_a_${RUN}`;
  const USER_B = `user_b_${RUN}`;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'postgres';
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

    // Seed provider + model. Phase 2 replaced the `central_providers`
    // singleton with the multi-provider catalog, so a model now needs a real
    // `providers` row to point at.
    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save(
      providerRepo.create({
        id: PROVIDER_ID,
        name: `Convs Provider ${RUN}`,
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
        displayName: `Test Model ${RUN}`,
        actualName: `test-model-${RUN}`,
        providerId: PROVIDER_ID,
        visibility: 'public',
        enabled: true,
        isDefault: true,
      }),
    );

    // ModelsService.resolveActiveModel reads AppConfig.default_model_id
    // (the source of truth for the admin-designated default), not the
    // Model.isDefault flag — so we update AppConfig here too. Without
    // this, the chat endpoint fails with no_model_available and never
    // creates the conversation under test.
    const { AppConfig } = await import('../../src/modules/app-config/entities/app-config.entity');
    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = MODEL_ID;
      await appConfigRepo.save(cfg);
    }

    // Register two users.
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

  // Helper: query the seeded user-a row directly.
  async function dsUserA(): Promise<{ id: string }> {
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [EMAIL_A]);
    return rows[0];
  }

  describe('GET /v1/conversations', () => {
    it('returns empty list for a fresh user', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenA}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('lists conversations after creating them via chat', async () => {
      // T006 is the conversations module; the chat-stream integration
      // (T005) is exercised elsewhere. Here we create conversations via
      // the ConversationsService directly so the e2e contract is
      // observable without depending on the streaming endpoint.
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'First message',
      });
      await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'Second message',
      });

      const res = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      // SQLite timestamps have second granularity, so both rows can share
      // an updatedAt when created in the same second — assert membership
      // and non-ascending timestamps instead of an exact row order.
      expect(new Set(res.body.items.map((i: any) => i.title))).toEqual(
        new Set(['First message', 'Second message']),
      );
      const stamps = res.body.items.map((i: any) => Date.parse(i.updatedAt));
      expect(stamps[0]).toBeGreaterThanOrEqual(stamps[1]);
    });

    it('only returns the caller\'s own conversations', async () => {
      const resA = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenA}`);
      const resB = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenB}`);

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      // User B has no conversations.
      expect(resB.body.items).toEqual([]);
    });
  });

  // ─── get detail ────────────────────────────────────────────────────────

  describe('GET /v1/conversations/:id', () => {
    it('returns full conversation with messages', async () => {
      // T006 is the conversations module; the chat-stream integration
      // (T005) is exercised elsewhere. Here we create conversations via
      // the ConversationsService directly so the e2e contract is
      // observable without depending on the streaming endpoint.
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'Hello detail',
      });

      const detailRes = await request(app.getHttpServer())
        .get(`/v1/conversations/${created.id}`)
        .set('Authorization', `Bearer ${accessTokenA}`);

      expect(detailRes.status).toBe(200);
      expect(detailRes.body.id).toBe(created.id);
      expect(detailRes.body.messages.length).toBeGreaterThanOrEqual(1);
      expect(detailRes.body.messages[0].role).toBe('user');
      expect(detailRes.body.messages[0].content).toBe('Hello detail');
      expect(detailRes.body.messages[0].status).toBe('completed');
    });

    it('GET /v1/conversations/:id includes modelDisplayName', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'Test chat',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/conversations/${created.id}`)
        .set('Authorization', `Bearer ${accessTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: created.id,
        modelId: MODEL_ID,
        modelDisplayName: `Test Model ${RUN}`,
      });
    });

    it('returns 403 for another user\'s conversation', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'secret',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/conversations/${created.id}`)
        .set('Authorization', `Bearer ${accessTokenB}`);

      expect(res.status).toBe(403);
    });
  });

  // ─── pin ───────────────────────────────────────────────────────────────

  describe('PATCH /v1/conversations/:id/pin', () => {
    it('pins a conversation and returns pinned=true', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'to pin',
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/conversations/${created.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ pinned: true });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: created.id, pinned: true });
    });

    it('lists pinned conversations first regardless of recency', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userId = (await dsUserA()).id;

      const older = await conversations.create({ userId, modelId: MODEL_ID, userMessage: 'older pinned' });
      const newer = await conversations.create({ userId, modelId: MODEL_ID, userMessage: 'newer unpinned' });

      await request(app.getHttpServer())
        .patch(`/v1/conversations/${older.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ pinned: true });

      const res = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenA}`);

      const items = res.body.items as Array<{ id: string; pinned: boolean }>;
      // Every pinned row must precede every unpinned row, even though the
      // pinned `older` row is less recent than the unpinned `newer` row.
      const lastPinned = Math.max(...items.map((i, idx) => (i.pinned ? idx : -1)));
      const firstUnpinned = Math.min(...items.map((i, idx) => (i.pinned ? Infinity : idx)));
      expect(lastPinned).toBeGreaterThanOrEqual(0);
      expect(firstUnpinned).toBeGreaterThan(lastPinned);
      expect(items.find((i) => i.id === older.id)?.pinned).toBe(true);
      expect(items.find((i) => i.id === newer.id)?.pinned).toBe(false);
    });

    it('can unpin a conversation', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'unpin me',
      });
      await request(app.getHttpServer())
        .patch(`/v1/conversations/${created.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ pinned: true });

      const res = await request(app.getHttpServer())
        .patch(`/v1/conversations/${created.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ pinned: false });

      expect(res.status).toBe(200);
      expect(res.body.pinned).toBe(false);
    });

    it('returns 403 for another user\'s conversation', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'not yours',
      });

      const res = await request(app.getHttpServer())
        .patch(`/v1/conversations/${created.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenB}`)
        .send({ pinned: true });

      expect(res.status).toBe(403);
    });

    it('returns 404 for a missing conversation', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/conversations/00000000-0000-0000-0000-000000000000/pin')
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ pinned: true });

      expect(res.status).toBe(404);
    });

    it('returns 400 when pinned is missing or non-boolean', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'validate me',
      });

      const missing = await request(app.getHttpServer())
        .patch(`/v1/conversations/${created.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({});
      expect(missing.status).toBe(400);

      const wrongType = await request(app.getHttpServer())
        .patch(`/v1/conversations/${created.id}/pin`)
        .set('Authorization', `Bearer ${accessTokenA}`)
        .send({ pinned: 'yes' });
      expect(wrongType.status).toBe(400);
    });

    it('requires authentication', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/conversations/whatever/pin')
        .send({ pinned: true });
      expect(res.status).toBe(401);
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe('DELETE /v1/conversations/:id', () => {
    it('deletes a conversation and it disappears from the list', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: MODEL_ID,
        userMessage: 'to delete',
      });

      const delRes = await request(app.getHttpServer())
        .delete(`/v1/conversations/${created.id}`)
        .set('Authorization', `Bearer ${accessTokenA}`);
      expect(delRes.status).toBe(204);

      const afterRes = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenA}`);
      expect(afterRes.body.items.find((c: any) => c.id === created.id)).toBeUndefined();
    });
  });
});
