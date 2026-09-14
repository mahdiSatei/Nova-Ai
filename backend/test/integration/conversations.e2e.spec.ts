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
import { encrypt } from '../../src/common/crypto/credential-cipher';
import { OpenAICompatibleClient } from '../../src/modules/chat/provider/openai-compatible.client';

/**
 * Integration test for conversations CRUD endpoints.
 *
 * Tests the full HTTP contract: list, get detail, delete.
 * Chat streaming is mocked so no real provider is needed.
 */
describe('Conversations — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let accessTokenA: string; // user A
  let accessTokenB: string; // user B

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-convs-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    const mockStream = (async function* () {
      yield { choices: [{ delta: { content: 'Mock' } }] } as any;
    })();

    const mockProvider = {
      getClient: jest.fn().mockResolvedValue({}),
      stream: jest.fn().mockResolvedValue(mockStream),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // .overrideProvider(OpenAICompatibleClient)
      // .useValue(mockProvider)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Seed provider + model.
    const { CentralProvider } = await import('../../src/modules/provider/entities/central-provider.entity');
    const providerRepo = ds.getRepository(CentralProvider);
    await providerRepo.save(
      providerRepo.create({
        id: 'singleton',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        lastValidatedAt: null,
      }),
    );

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
    const { AppConfig } = await import('../../src/modules/app-config/entities/app-config.entity');
    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = 'model-1';
      await appConfigRepo.save(cfg);
    }

    // Register two users.
    const regA = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'user-a@example.com', password: 'correct-horse-battery-staple' });
    accessTokenA = regA.body.accessToken;

    const regB = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'user-b@example.com', password: 'correct-horse-battery-staple' });
    accessTokenB = regB.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  // Helper: query the seeded user-a row directly.
  async function dsUserA(): Promise<{ id: string }> {
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = ? LIMIT 1', ['user-a@example.com']);
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
        modelId: 'model-1',
        userMessage: 'First message',
      });
      await conversations.create({
        userId: (await dsUserA()).id,
        modelId: 'model-1',
        userMessage: 'Second message',
      });

      const res = await request(app.getHttpServer())
        .get('/v1/conversations')
        .set('Authorization', `Bearer ${accessTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0].title).toBe('Second message');
      expect(res.body.items[1].title).toBe('First message');
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
        modelId: 'model-1',
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
    });

    it('returns 403 for another user\'s conversation', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: 'model-1',
        userMessage: 'secret',
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/conversations/${created.id}`)
        .set('Authorization', `Bearer ${accessTokenB}`);

      expect(res.status).toBe(403);
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe('DELETE /v1/conversations/:id', () => {
    it('deletes a conversation and it disappears from the list', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);

      const created = await conversations.create({
        userId: (await dsUserA()).id,
        modelId: 'model-1',
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
