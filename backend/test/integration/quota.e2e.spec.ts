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
import { Quota } from '../../src/modules/quotas/entities/quota.entity';
import { QuotaRule } from '../../src/modules/quotas/entities/quota-rule.entity';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';

/**
 * Phase 5 quota acceptance suite (PostgreSQL, database `chatbot_test`).
 */
describe('Quotas — e2e', () => {
  let app: INestApplication;
  let ds: DataSource;
  let adminToken: string;
  let userToken: string;
  let userId: string;

  const RUN = Date.now().toString(36);
  const PASSWORD = 'correct-horse-battery-staple';
  const EMAIL_ADMIN = `quota-admin-${RUN}@example.com`;
  const EMAIL_USER = `quota-user-${RUN}@example.com`;
  const IDS = {
    provider: `quota-prov-${RUN}`,
    model: randomUUID(),
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
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString('base64');

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
        id: IDS.provider,
        name: `Quota Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    );

    const modelRepo = ds.getRepository(Model);
    await modelRepo.save(
      modelRepo.create({
        id: IDS.model,
        displayName: `Quota Model ${RUN}`,
        actualName: `quota-model-${RUN}`,
        providerId: IDS.provider,
        visibility: 'public',
        enabled: true,
      }),
    );

    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = IDS.model;
      await appConfigRepo.save(cfg);
    }

    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);
    await userRepo.save([
      userRepo.create({ email: EMAIL_ADMIN, passwordHash, role: 'admin', accessTier: 'free' }),
      userRepo.create({ email: EMAIL_USER, passwordHash, role: 'user', accessTier: 'free' }),
    ]);

    const user = await userRepo.findOne({ where: { email: EMAIL_USER } });
    userId = user?.id ?? '';

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/admin/auth/login')
      .send({ identifier: EMAIL_ADMIN, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;

    const userLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: EMAIL_USER, password: PASSWORD });
    userToken = userLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('GET /v1/admin/quota-rules', () => {
    it('lists the seeded default rules for admins', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/quota-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const tiers = res.body.items.map((r: any) => r.tier);
      expect(tiers).toContain('free');
      expect(tiers).toContain('commercial');
    });

    it('returns 403 for non-admin users', async () => {
      await request(app.getHttpServer())
        .get('/v1/admin/quota-rules')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('returns 401 with no token', async () => {
      await request(app.getHttpServer()).get('/v1/admin/quota-rules').expect(401);
    });
  });

  describe('PATCH /v1/admin/quota-rules/:id', () => {
    it('lets an admin change a tier limit and the change is persisted', async () => {
      const list = await request(app.getHttpServer())
        .get('/v1/admin/quota-rules')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const freeRule = list.body.items.find((r: any) => r.tier === 'free');
      expect(freeRule).toBeDefined();

      const patched = await request(app.getHttpServer())
        .patch(`/v1/admin/quota-rules/${freeRule.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tokenLimit: 123456, label: `Free ${RUN}` })
        .expect(200);

      expect(patched.body.tokenLimit).toBe(123456);
      expect(patched.body.label).toBe(`Free ${RUN}`);

      const ruleRepo = ds.getRepository(QuotaRule);
      const persisted = await ruleRepo.findOne({ where: { id: freeRule.id } });
      expect(Number(persisted?.tokenLimit)).toBe(123456);
    });

    it('returns 404 for an unknown rule id', async () => {
      await request(app.getHttpServer())
        .patch(`/v1/admin/quota-rules/${randomUUID()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ tokenLimit: 1 })
        .expect(404);
    });
  });

  describe('GET /v1/users/me/quota', () => {
    it('creates the quota row on first read and reports the tier limit', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/users/me/quota')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(res.body.tokenLimit).toBeGreaterThan(0);
      expect(res.body.tokenUsed).toBe(0);
      expect(res.body.tokenRemaining).toBe(res.body.tokenLimit);

      const quotaRepo = ds.getRepository(Quota);
      const row = await quotaRepo.findOne({ where: { userId } });
      expect(row).toBeDefined();
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer()).get('/v1/users/me/quota').expect(401);
    });
  });

  describe('quota enforcement in chat', () => {
    it('rejects with quota_exceeded before provider invocation when exhausted', async () => {
      const quotaRepo = ds.getRepository(Quota);
      await quotaRepo.update({ userId }, { tokenLimit: 1, tokenUsed: 1 });

      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ message: 'this message needs far more than one token' });

      const body = res.text ?? '';
      expect(body).toContain('quota_exceeded');
    });

    it('admins are never blocked by quota', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/users/me/quota')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.tokenLimit).toBe(0); // unlimited sentinel
    });
  });

  describe('concurrency safety', () => {
    it('parallel reservations cannot collectively exceed the limit', async () => {
      const quotaRepo = ds.getRepository(Quota);
      await quotaRepo.update(
        { userId },
        { tokenLimit: 1000, tokenUsed: 0 },
      );

      const quotaService = app.get(require('../../src/modules/quotas/quotas.service').QuotaService);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => quotaService.checkAndReserve(userId, 400)),
      );

      const granted = results.filter((r: any) => r.reserved).length;
      // Only 2 * 400 = 800 fits inside a 1000 token budget
      expect(granted).toBe(2);

      const row = await quotaRepo.findOne({ where: { userId } });
      expect(Number(row?.tokenUsed)).toBeLessThanOrEqual(1000);
    });
  });
});
