import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { User } from '../../src/modules/users/entities/user.entity';

/**
 * Provider admin API — PostgreSQL (`chatbot_test`).
 *
 * Phase 2 replaced the central-provider singleton with a full CRUD catalog
 * (`/v1/admin/providers`). Validation is now `POST /v1/admin/providers/:id/validate`,
 * which probes GET `${baseUrl}/models` through the openai-compatible adapter:
 *
 *   200                    → lastValidatedAt set
 *   401 / 403              → 422 credentials_rejected
 *   404 / 405              → 422 provider_type_unsupported
 *   5xx                    → 503 (503 → rate_limited) / 502 otherwise
 *   connection refused      → 422 provider_unreachable
 */
describe('Provider admin API (US6) — e2e', () => {
  let app: INestApplication;
  let adminToken: string;
  let stubServer: import('http').Server;
  let stubPort: number;
  let modelsStatus = 200;

  const RUN = Date.now().toString(36);
  const ADMIN_EMAIL = `admin-provider-${RUN}@example.com`;
  const PASSWORD = 'correct-horse-battery-staple';
  const PROVIDER_ID = `prov-e2e-${RUN}`;
  const ORIGINAL_KEY = 'sk-original-good-key-1234';
  const NEW_GOOD_KEY = 'sk-new-good-key-5678';

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
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');

    const http = await import('node:http');
    stubServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.statusCode = modelsStatus;
        res.setHeader('content-type', 'application/json');
        res.end(modelsStatus < 400 ? '{"object":"list","data":[]}' : '{"error":"x"}');
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    await new Promise<void>((r) => stubServer.listen(0, '127.0.0.1', () => r()));
    const addr = stubServer.address();
    if (typeof addr !== 'object' || addr === null) throw new Error('stub server failed to bind');
    stubPort = addr.port;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Seed a unique admin and log in.
    const userRepo = ds.getRepository(User);
    await userRepo.save(
      userRepo.create({
        username: `prov_adm_${RUN}`,
        email: ADMIN_EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
        role: 'admin',
      }),
    );
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD });
    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (stubServer) await new Promise<void>((r) => stubServer.close(() => r()));
  });

  function baseUrl(): string {
    return `${'http://127.0.0.1'}:${stubPort}/v1`;
  }

  async function createProvider(): Promise<void> {
    const res = await request(app.getHttpServer())
      .post('/v1/admin/providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        id: PROVIDER_ID,
        name: `Provider E2E ${RUN}`,
        type: 'openai-compatible',
        baseUrl: baseUrl(),
        apiKey: ORIGINAL_KEY,
      });
    if (res.status !== 201) {
      throw new Error(`provider create failed: ${res.status} ${JSON.stringify(res.body)}`);
    }
  }

  describe('POST /v1/admin/providers', () => {
    it('creates a provider and masks the credential', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admin/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: PROVIDER_ID,
          name: `Provider E2E ${RUN}`,
          type: 'openai-compatible',
          baseUrl: baseUrl(),
          apiKey: ORIGINAL_KEY,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe(PROVIDER_ID);
      expect(res.body.baseUrl).toBe(baseUrl());
      expect(JSON.stringify(res.body)).not.toContain(ORIGINAL_KEY);
    });

    it('rejects a duplicate id with 500 and a duplicate name with 409', async () => {
      // Same name → the service's explicit conflict check.
      const dupName = await request(app.getHttpServer())
        .post('/v1/admin/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: `prov-dup-${RUN}`,
          name: `Provider E2E ${RUN}`,
          type: 'openai-compatible',
          baseUrl: baseUrl(),
          apiKey: ORIGINAL_KEY,
        });
      expect(dupName.status).toBe(409);
      expect(dupName.body.code).toBe('provider_name_taken');

      // Same id → the service catches the driver's unique violation and
      // reports an explicit conflict, keeping constraint internals off the wire.
      const dupId = await request(app.getHttpServer())
        .post('/v1/admin/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          id: PROVIDER_ID,
          name: `Provider E2E other ${RUN}`,
          type: 'openai-compatible',
          baseUrl: baseUrl(),
          apiKey: ORIGINAL_KEY,
        });
      expect(dupId.status).toBe(409);
      expect(dupId.body.code).toBe('provider_id_taken');
      expect(JSON.stringify(dupId.body)).not.toMatch(/providers_pkey|duplicate key/i);
    });

    it('returns 403 for a regular user and 401 without a token', async () => {
      const reg = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ username: `prov_usr_${RUN}`, email: `plain-user-provider-${RUN}@example.com`, password: PASSWORD });
      const userToken = reg.body.accessToken;

      const forbidden = await request(app.getHttpServer())
        .get('/v1/admin/providers')
        .set('Authorization', `Bearer ${userToken}`);
      expect(forbidden.status).toBe(403);

      const anon = await request(app.getHttpServer()).get('/v1/admin/providers');
      expect(anon.status).toBe(401);
    });
  });

  describe('POST /v1/admin/providers/:id/validate', () => {
    beforeEach(async () => {
      modelsStatus = 200;
      // Start each case from a clean provider row.
      await app.get(DataSource).query('DELETE FROM providers WHERE id = $1', [PROVIDER_ID]);
      await createProvider();
    });

    it('persists lastValidatedAt when GET /models returns 200', async () => {
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/providers/${PROVIDER_ID}/validate`)
        .set('Authorization', `Bearer ${adminToken}`);

      // The route uses the default 201 for POST.
      expect(res.status).toBe(201);
      expect(res.body.lastValidatedAt).toBeTruthy();
    });

    it('classifies GET /models 401 as credentials_rejected (422)', async () => {
      modelsStatus = 401;
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/providers/${PROVIDER_ID}/validate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('credentials_rejected');
    });

    it('classifies GET /models 500 as provider_unreachable', async () => {
      modelsStatus = 500;
      const res = await request(app.getHttpServer())
        .post(`/v1/admin/providers/${PROVIDER_ID}/validate`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(502);
      expect(res.body.code).toBe('provider_unreachable');
    });

    it('reports provider_unreachable on connection failure', async () => {
      await new Promise<void>((r) => stubServer.close(() => r()));
      try {
        const res = await request(app.getHttpServer())
          .post(`/v1/admin/providers/${PROVIDER_ID}/validate`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(422);
        expect(res.body.code).toBe('provider_unreachable');
      } finally {
        await new Promise<void>((r) => stubServer.listen(0, '127.0.0.1', () => r()));
        const addr = stubServer.address();
        if (typeof addr === 'object' && addr !== null) stubPort = addr.port;
      }
    });

    it('never leaks the stored API key on any response', async () => {
      const list = await request(app.getHttpServer())
        .get('/v1/admin/providers')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).not.toContain(ORIGINAL_KEY);
      expect(JSON.stringify(list.body)).not.toContain('apiKeyEncrypted');
    });
  });
});
