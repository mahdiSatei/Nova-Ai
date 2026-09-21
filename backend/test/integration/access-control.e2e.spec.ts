import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { Model } from '../../src/modules/models/entities/model.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { encrypt } from '../../src/common/crypto/credential-cipher';

/**
 * Model access-control acceptance suite (PostgreSQL, database `chatbot_test`).
 *
 * Phase 5 retired the access-tier ladder: entitlement is now only `public`
 * (any authenticated user) or `private` (admin role only). Spend is governed by
 * the credit wallet instead, so no tier appears here.
 *
 * Runs are id-scoped (`RUN`) so the suite is re-runnable against a shared test
 * database, and catalog assertions are containment-based because other suites
 * may have seeded their own public models alongside ours.
 */
describe('Model access control — e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let tokens: { user: string; admin: string };
  let userId: string;

  const RUN = Date.now().toString(36);
  const PASSWORD = 'correct-horse-battery-staple';
  const EMAILS = {
    user: `access-user-${RUN}@example.com`,
    admin: `access-admin-${RUN}@example.com`,
  };
  // `models.id` is a real `uuid` column (see the init migration), so seeds must
  // use UUIDs rather than readable string ids.
  const IDS = {
    public: randomUUID(),
    private: randomUUID(),
    disabled: randomUUID(),
  };

  jest.setTimeout(60_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD = process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    ds = app.get(DataSource);
    await ds.runMigrations();

    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save(
      providerRepo.create({
        id: `prov-${RUN}`,
        name: `Access Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    );

    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      modelRepo.create({
        id: IDS.public,
        displayName: `Public ${RUN}`,
        actualName: 'pub-model',
        providerId: `prov-${RUN}`,
        visibility: 'public',
        enabled: true,
      }),
      modelRepo.create({
        id: IDS.private,
        displayName: `Private ${RUN}`,
        actualName: 'priv-model',
        providerId: `prov-${RUN}`,
        visibility: 'private',
        enabled: true,
      }),
      modelRepo.create({
        id: IDS.disabled,
        displayName: `Disabled ${RUN}`,
        actualName: 'dis-model',
        providerId: `prov-${RUN}`,
        visibility: 'public',
        enabled: false,
      }),
    ]);

    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);
    await userRepo.save([
      userRepo.create({ email: EMAILS.user, passwordHash, role: 'user' }),
      userRepo.create({ email: EMAILS.admin, passwordHash, role: 'admin' }),
    ]);

    const userLogin = async (email: string): Promise<string> => {
      // The login contract takes `identifier` (email or username), not `email`.
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send({ identifier: email, password: PASSWORD });
      if (res.status !== 200) {
        throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
      }
      return res.body.accessToken;
    };

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ identifier: EMAILS.admin, password: PASSWORD });
    if (adminLogin.status !== 200) {
      throw new Error(
        `admin login failed: ${adminLogin.status} ${JSON.stringify(adminLogin.body)}`,
      );
    }

    tokens = {
      user: await userLogin(EMAILS.user),
      admin: adminLogin.body.accessToken,
    };
    userId = (await userRepo.findOneOrFail({ where: { email: EMAILS.user } })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  async function catalogIds(token: string): Promise<string[]> {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    return res.body.items.map((i: { id: string }) => i.id);
  }

  async function createConversation(): Promise<string> {
    const conversations = app.get(ConversationsService);
    const conv = await conversations.create({
      userId,
      modelId: IDS.public,
      userMessage: 'seed',
    });
    return conv.id;
  }

  it('AC: a regular user sees only public enabled models', async () => {
    const ids = await catalogIds(tokens.user);
    expect(ids).toContain(IDS.public);
    expect(ids).not.toContain(IDS.private);
    expect(ids).not.toContain(IDS.disabled);
  });

  it('AC: an admin sees private models but never disabled ones', async () => {
    const ids = await catalogIds(tokens.admin);
    expect(ids).toContain(IDS.public);
    expect(ids).toContain(IDS.private);
    expect(ids).not.toContain(IDS.disabled);
  });

  it('the public catalog never exposes admin-only fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${tokens.user}`);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('actualName');
    expect(serialized).not.toContain('enabled');
    for (const item of res.body.items) {
      expect(Object.keys(item).sort()).toEqual(['displayName', 'id', 'isDefault']);
    }
  });

  it('AC: switching a conversation to a private model is rejected server-side', async () => {
    const conversationId = await createConversation();

    const priv = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.user}`)
      .send({ modelId: IDS.private });
    expect(priv.status).toBe(403);
    expect(priv.body.code).toBe('model_forbidden');

    const unknown = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.user}`)
      .send({ modelId: '00000000-0000-4000-8000-000000000999' });
    expect(unknown.status).toBe(422);
    expect(unknown.body.code).toBe('model_unavailable');

    const disabled = await request(app.getHttpServer())
      .patch(`/v1/conversations/${conversationId}/model`)
      .set('Authorization', `Bearer ${tokens.user}`)
      .send({ modelId: IDS.disabled });
    expect(disabled.status).toBe(422);
    expect(disabled.body.code).toBe('model_unavailable');

    // The conversation is untouched by every rejected attempt.
    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${tokens.user}`);
    expect(detail.body.modelId).toBe(IDS.public);
  });

  it('AC: the sticky model preference rejects private models', async () => {
    const denied = await request(app.getHttpServer())
      .patch('/v1/users/me/model-preference')
      .set('Authorization', `Bearer ${tokens.user}`)
      .send({ modelId: IDS.private });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('model_forbidden');

    const allowed = await request(app.getHttpServer())
      .patch('/v1/users/me/model-preference')
      .set('Authorization', `Bearer ${tokens.user}`)
      .send({ modelId: IDS.public });
    expect(allowed.status).toBe(200);
    expect(allowed.body.modelId).toBe(IDS.public);
  });

  it('AC: the chat stream emits model_forbidden for a private explicit model', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${tokens.user}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'hello', modelId: IDS.private });

    expect(res.status).toBe(200);
    expect(res.text).toContain('model_forbidden');
  });

  it('AC: an admin can flip a model between public and private with immediate effect', async () => {
    const create = await request(app.getHttpServer())
      .post('/v1/admin/models')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({
        displayName: `Admin-only ${RUN}`,
        actualName: 'admin-only-model',
        providerId: `prov-${RUN}`,
        visibility: 'private',
        inputPricePer1m: 100_000,
        outputPricePer1m: 300_000,
      });
    expect(create.status).toBe(201);
    expect(create.body.visibility).toBe('private');
    expect(Number(create.body.inputPricePer1m)).toBe(100_000);

    await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.private}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ visibility: 'public' })
      .expect(200);

    expect(await catalogIds(tokens.user)).toContain(IDS.private);

    await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.private}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ visibility: 'private' })
      .expect(200);

    expect(await catalogIds(tokens.user)).not.toContain(IDS.private);
  });

  it('the admin user list is role-only and never leaks the password hash', async () => {
    const list = await request(app.getHttpServer())
      .get(`/v1/admin/users?query=${encodeURIComponent(EMAILS.user)}`)
      .set('Authorization', `Bearer ${tokens.admin}`);
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].role).toBe('user');
    expect(list.body.items[0]).not.toHaveProperty('accessTier');
    expect(JSON.stringify(list.body)).not.toContain('passwordHash');
    expect(JSON.stringify(list.body)).not.toContain('$argon2');
  });

  it('non-admins cannot reach the admin surface', async () => {
    const list = await request(app.getHttpServer())
      .get('/v1/admin/users')
      .set('Authorization', `Bearer ${tokens.user}`);
    expect(list.status).toBe(403);

    const patchModel = await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.private}`)
      .set('Authorization', `Bearer ${tokens.user}`)
      .send({ visibility: 'public' });
    expect(patchModel.status).toBe(403);
  });

  it('the retired access-tier endpoint no longer exists', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/v1/admin/users/${userId}/access-tier`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ accessTier: 'commercial' });
    expect(res.status).toBe(404);
  });

  it('the system default cannot be made non-public', async () => {
    const cfgRepo = ds.getRepository(AppConfig);
    const previous = await cfgRepo.findOne({ where: { id: 'singleton' } });

    const put = await request(app.getHttpServer())
      .put('/v1/admin/config')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ defaultModelId: IDS.private });
    expect(put.status).toBe(422);
    expect(put.body.code).toBe('model_not_eligible_default');

    const setPublic = await request(app.getHttpServer())
      .put('/v1/admin/config')
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ defaultModelId: IDS.public });
    expect(setPublic.status).toBe(200);

    const demote = await request(app.getHttpServer())
      .patch(`/v1/admin/models/${IDS.public}`)
      .set('Authorization', `Bearer ${tokens.admin}`)
      .send({ visibility: 'private' });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('model_is_default');

    // Restore the singleton pointer for other suites.
    if (previous?.defaultModelId) {
      await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ defaultModelId: previous.defaultModelId });
    }
  });
});
