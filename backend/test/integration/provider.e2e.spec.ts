import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { User } from '../../src/modules/users/entities/user.entity';
import { CentralProvider } from '../../src/modules/provider/entities/central-provider.entity';
import { decrypt } from '../../src/common/crypto/credential-cipher';

describe('Central provider (US6) — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let adminToken: string;
  let stubServer: import('http').Server;
  let stubPort: number;
  let probeResponse: { status: number; body: string } = { status: 200, body: '{}' };

  const ADMIN_EMAIL = 'admin-provider@example.com';
  const PASSWORD = 'correct-horse-battery-staple';
  const ORIGINAL_KEY = 'sk-original-good-key-1234';
  const NEW_BAD_KEY = 'sk-new-bad-key-9999';
  const NEW_GOOD_KEY = 'sk-new-good-key-5678';
  const BASE_URL_PATTERN = 'http://127.0.0.1';

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-provider-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 0x42).toString('base64');

    const http = await import('node:http');
    stubServer = http.createServer((req, res) => {
      // ProviderService probes `${baseUrl}/chat/completions`; our
      // baseUrl is `${BASE_URL_PATTERN}:${stubPort}/v1`, so the probe
      // hits `/v1/chat/completions`.
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        res.statusCode = probeResponse.status;
        res.setHeader('content-type', 'application/json');
        res.end(probeResponse.body);
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

    const userRepo = ds.getRepository(User);
    await userRepo.save(
      userRepo.create({
        email: ADMIN_EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
        role: 'admin',
      }),
    );
    const loginRes = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    adminToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (stubServer) await new Promise<void>((r) => stubServer.close(() => r()));
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  function baseUrl(): string {
    return `${BASE_URL_PATTERN}:${stubPort}/v1`;
  }

  describe('GET /v1/admin/provider', () => {
    it('returns isConfigured:false when no row exists', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ isConfigured: false });
    });

    it('returns a masked credential once configured', async () => {
      const { encrypt } = await import('../../src/common/crypto/credential-cipher');
      const ds = app.get(DataSource);
      const repo = ds.getRepository(CentralProvider);
      await repo.save({
        id: 'singleton',
        baseUrl: baseUrl(),
        apiKeyEncrypted: encrypt(ORIGINAL_KEY),
        lastValidatedAt: new Date('2026-09-14T00:00:00Z'),
      });

      const res = await request(app.getHttpServer())
        .get('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.isConfigured).toBe(true);
      expect(res.body.baseUrl).toBe(baseUrl());
      expect(res.body.apiKeyMasked).toBe('***1234');
      expect(res.body.lastValidatedAt).toBe('2026-09-14T00:00:00.000Z');
      expect(JSON.stringify(res.body)).not.toContain(ORIGINAL_KEY);
    });
  });

  describe('PUT /v1/admin/provider', () => {
    beforeEach(async () => {
      const ds = app.get(DataSource);
      await ds.query('DELETE FROM central_provider WHERE id = ?', ['singleton']);
    });

    it('persists when the probe returns 200 and sets lastValidatedAt', async () => {
      probeResponse = { status: 200, body: '{"choices":[]}' };

      const res = await request(app.getHttpServer())
        .put('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ baseUrl: baseUrl(), apiKey: NEW_GOOD_KEY });

      expect(res.status).toBe(200);
      expect(res.body.isConfigured).toBe(true);
      expect(res.body.apiKeyMasked).toBe('***5678');
      expect(res.body.lastValidatedAt).toBeTruthy();

      const ds = app.get(DataSource);
      const row = await ds.getRepository(CentralProvider).findOne({ where: { id: 'singleton' } });
      expect(row).not.toBeNull();
      expect(row!.apiKeyEncrypted).not.toContain(NEW_GOOD_KEY);
      expect(decrypt(row!.apiKeyEncrypted)).toBe(NEW_GOOD_KEY);
    });

    it('rejects with 422 and leaves prior config untouched when the probe returns 401', async () => {
      probeResponse = { status: 200, body: '{"choices":[]}' };
      const seedRes = await request(app.getHttpServer())
        .put('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ baseUrl: baseUrl(), apiKey: ORIGINAL_KEY });
      expect(seedRes.status).toBe(200);

      probeResponse = { status: 401, body: '{"error":"unauthorized"}' };
      const failRes = await request(app.getHttpServer())
        .put('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ baseUrl: baseUrl(), apiKey: NEW_BAD_KEY });

      expect(failRes.status).toBe(422);
      expect(failRes.body.code).toBe('credentials_rejected');

      const getRes = await request(app.getHttpServer())
        .get('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.apiKeyMasked).toBe('***1234');
      expect(JSON.stringify(getRes.body)).not.toContain(NEW_BAD_KEY);
    });

    it('rejects with 422 (provider_unreachable) on network failure', async () => {
      await new Promise<void>((r) => stubServer.close(() => r()));
      const res = await request(app.getHttpServer())
        .put('/v1/admin/provider')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ baseUrl: baseUrl(), apiKey: NEW_GOOD_KEY });

      expect(res.status).toBe(422);
      expect(res.body.code).toBe('provider_unreachable');
    });

    it('rejects with 403 when called by a non-admin user', async () => {
      const userReg = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'plain-user-provider@example.com', password: PASSWORD });
      const userToken = userReg.body.accessToken;

      const res = await request(app.getHttpServer())
        .put('/v1/admin/provider')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ baseUrl: baseUrl(), apiKey: NEW_GOOD_KEY });
      expect(res.status).toBe(403);
    });
  });
});
