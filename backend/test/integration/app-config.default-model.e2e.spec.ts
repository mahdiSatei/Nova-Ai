import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { User } from '../../src/modules/users/entities/user.entity';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';

describe('App config / default model (US8) — e2e', () => {
  let app: INestApplication;
  let adminToken: string;
  let userToken: string;

  const RUN = Date.now().toString(36);
  const ADMIN_EMAIL = `admin-default-${RUN}@example.com`;
  const USER_EMAIL = `user-default-${RUN}@example.com`;
  const PASSWORD = 'correct-horse-battery-staple';
  const PROVIDER_ID = `appcfg-prov-${RUN}`;

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
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Models require a provider (NOT NULL FK).
    const providerRepo = ds.getRepository(Provider);
    if (!(await providerRepo.findOne({ where: { id: PROVIDER_ID } }))) {
      await providerRepo.save(
        providerRepo.create({
          id: PROVIDER_ID,
          name: `App Config Provider ${RUN}`,
          type: 'openai-compatible',
          baseUrl: 'http://localhost:9999',
          apiKeyEncrypted: encrypt('test-api-key'),
          isActive: true,
        }),
      );
    }

    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);
    await userRepo.save(
      userRepo.create({ email: ADMIN_EMAIL, passwordHash, role: 'admin' }),
    );
    await userRepo.save(
      userRepo.create({ email: USER_EMAIL, passwordHash, role: 'user' }),
    );

    const adminLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;

    const userLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: USER_EMAIL, password: PASSWORD });
    userToken = userLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(async () => {
    const ds = app.get(DataSource);
    await ds.query('DELETE FROM conversations');
    await ds.query('DELETE FROM models');
    await ds.query('UPDATE app_config SET default_model_id = NULL WHERE id = $1', ['singleton']);
  });

  async function adminCreateModel(displayName: string, actualName: string, enabled = true): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/models')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ displayName, actualName, enabled, providerId: PROVIDER_ID });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  describe('GET /v1/admin/config', () => {
    it('returns defaultModelId:null when nothing is set', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ defaultModelId: null });
    });

    it('returns 403 for a regular user', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/config')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PUT /v1/admin/config', () => {
    it('sets a default; the public picker reflects isDefault', async () => {
      const m1 = await adminCreateModel('Alpha', 'gpt-alpha');
      const m2 = await adminCreateModel('Beta', 'gpt-beta');

      const setRes = await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: m1 });
      expect(setRes.status).toBe(200);
      expect(setRes.body).toEqual({ defaultModelId: m1 });

      const listRes = await request(app.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${userToken}`);
      expect(listRes.status).toBe(200);
      const byId = Object.fromEntries(listRes.body.items.map((m: any) => [m.id, m]));
      expect(byId[m1].isDefault).toBe(true);
      expect(byId[m2].isDefault).toBe(false);
    });

    it('replaces the default; prior default is cleared atomically', async () => {
      const m1 = await adminCreateModel('Alpha', 'gpt-alpha');
      const m2 = await adminCreateModel('Beta', 'gpt-beta');

      await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: m1 })
        .expect(200);

      await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: m2 })
        .expect(200);

      const listRes = await request(app.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${userToken}`);
      const byId = Object.fromEntries(listRes.body.items.map((m: any) => [m.id, m]));
      expect(byId[m1].isDefault).toBe(false);
      expect(byId[m2].isDefault).toBe(true);
    });

    it('clears the default with defaultModelId:null', async () => {
      const m1 = await adminCreateModel('Alpha', 'gpt-alpha');
      await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: m1 })
        .expect(200);

      const clearRes = await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: null });
      expect(clearRes.status).toBe(200);
      expect(clearRes.body).toEqual({ defaultModelId: null });

      const listRes = await request(app.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${userToken}`);
      const m = listRes.body.items.find((it: any) => it.id === m1);
      expect(m.isDefault).toBe(false);
    });

    it('rejects with 422 when the referenced model does not exist', async () => {
      const res = await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('model_not_found');
    });

    it('rejects with 422 when the referenced model is disabled', async () => {
      const m1 = await adminCreateModel('Disabled', 'gpt-disabled', false);
      const res = await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ defaultModelId: m1 });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('model_not_eligible_default');
    });

    it('rejects with 403 for a regular user', async () => {
      const res = await request(app.getHttpServer())
        .put('/v1/admin/config')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ defaultModelId: null });
      expect(res.status).toBe(403);
    });
  });
});
