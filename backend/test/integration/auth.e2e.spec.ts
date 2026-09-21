import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * End-to-end integration test: register → login → refresh → logout.
 *
 * Boots the full AppModule against the `chatbot_test` PostgreSQL database
 * and runs migrations. Accounts are suffixed with a per-run token so the
 * suite is repeatable against a persistent database.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;

  const RUN = Date.now().toString(36);

  // Bcrypt at cost 12 takes ~hundreds of ms per hash; the e2e flow
  // does register + login + refresh (which re-hashes nothing) plus
  // argon2 setup overhead, so we extend the default timeout.
  jest.setTimeout(30_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD =
      process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET =
      'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET =
      'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString(
      'base64',
    );

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

    // Run migrations against the in-process DataSource.
    const ds = app.get(DataSource);
    await ds.runMigrations();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('end-to-end: register → login → refresh → logout', async () => {
    const server = app.getHttpServer();
    const password = 'correct-horse-battery-staple';
    const email = `e2e-user-${RUN}@example.com`;
    const username = `e2e_user_${RUN}`;

    // 1. Register
    const reg = await request(server)
      .post('/v1/auth/register')
      .send({ username, email, password });

    expect(reg.status).toBe(201);
    expect(reg.body.accessToken).toMatch(/\./); // JWT-shaped
    expect(reg.body.refreshToken).toMatch(/\./);
    expect(reg.body.user.email).toBe(email);
    expect(reg.body.user.role).toBe('user');

    // 2. Login
    const login = await request(server)
      .post('/v1/auth/login')
      .send({ identifier: email, password });

    expect(login.status).toBe(200);
    const accessAfterLogin = login.body.accessToken;
    const refreshAfterLogin = login.body.refreshToken;

    // 3. Wrong password is generic 401 (no enumeration)
    const wrong = await request(server)
      .post('/v1/auth/login')
      .send({
        identifier: email,
        password: 'wrong-password-long-enough',
      });

    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('invalid_credentials');

    // 4. Refresh
    const ref = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: refreshAfterLogin });

    expect(ref.status).toBe(200);
    expect(ref.body.accessToken).toBeDefined();
    expect(ref.body.refreshToken).toBeDefined();
    expect(ref.body.refreshToken).not.toBe(refreshAfterLogin); // rotated

    // 5. Old refresh token is no longer accepted
    const refOld = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: refreshAfterLogin });

    expect(refOld.status).toBe(401);

    // 6. Logout with the latest access token
    const logout = await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${ref.body.accessToken}`);

    expect(logout.status).toBe(204);

    // 7. After logout, the access token is rejected
    const afterLogout = await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${ref.body.accessToken}`);

    expect(afterLogout.status).toBe(401);

    // 8. Refresh with the new token still works (refresh lifetime not revoked by logout)
    const ref2 = await request(server)
      .post('/v1/auth/refresh')
      .send({ refreshToken: ref.body.refreshToken });

    expect(ref2.status).toBe(200);

    // 9. Health endpoints
    expect((await request(server).get('/healthz')).status).toBe(200);
    expect((await request(server).get('/readyz')).status).toBe(200);
  });

  describe('Admin auth', () => {
    it('admin login with valid admin credentials returns 200 with role=admin', async () => {
      const server = app.getHttpServer();
      const email = `e2e-admin-${RUN}@example.com`;
      const password = 'correct-horse-battery-staple';

      // Seed an admin directly (registration endpoint always creates role=user).
      await request(server)
        .post('/v1/auth/register')
        .send({
          username: `e2e_admin_${RUN}`,
          email,
          password,
        });

      const ds = app.get(DataSource);
      await ds.getRepository('users').update({ email }, { role: 'admin' });

      const res = await request(server)
        .post('/v1/admin/auth/login')
        .send({ identifier: email, password });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.role).toBe('admin');
    });

    it('admin login with valid non-admin credentials returns generic 401', async () => {
      const server = app.getHttpServer();
      const email = `e2e-non-admin-${RUN}@example.com`;
      const password = 'correct-horse-battery-staple';

      await request(server)
        .post('/v1/auth/register')
        .send({
          username: `e2e_nonadm_${RUN}`,
          email,
          password,
        }); // role=user

      const res = await request(server)
        .post('/v1/admin/auth/login')
        .send({ identifier: email, password });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_credentials');
      expect(res.body.message).toBe(
        'The provided credentials were invalid.',
      );
      expect(res.body.accessToken).toBeUndefined();
    });

    it('admin login with unknown email returns generic 401 (no enumeration)', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/v1/admin/auth/login')
        .send({
          identifier: 'ghost@example.com',
          password: 'whatever-12-chars',
        });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_credentials');
    });

    it('admin login with short password returns 400 validation_failed', async () => {
      const server = app.getHttpServer();

      const res = await request(server)
        .post('/v1/admin/auth/login')
        .send({
          identifier: 'a@b.co',
          password: 'short',
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('validation_failed');
    });
  });
});