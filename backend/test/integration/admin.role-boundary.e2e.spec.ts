import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { User } from '../../src/modules/users/entities/user.entity';

/**
 * US5 admin role boundary.
 *
 * Boots the full AppModule against `chatbot_test` (PostgreSQL) and exercises the
 * three authentication states against the placeholder admin route
 * (`GET /v1/admin/models`):
 *
 *   - anonymous request        → 401
 *   - regular user JWT          → 403
 *   - admin JWT                 → 200
 */
describe('Admin role boundary (US5)', () => {
  let app: INestApplication;
  let adminId: string;
  let userId: string;
  let adminAccessToken: string;
  let userAccessToken: string;

  const RUN = Date.now().toString(36);
  const ADMIN_EMAIL = `admin-rolebound-${RUN}@example.com`;
  const USER_EMAIL = `user-rolebound-${RUN}@example.com`;
  const PASSWORD = 'correct-horse-battery-staple';

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

    // Seed admin + regular user directly. We bypass the auth
    // registration endpoint for both because /v1/auth/register always
    // creates role='user'; admin accounts are out-of-band per spec.
    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);

    const admin = await userRepo.save(
      userRepo.create({
        email: ADMIN_EMAIL,
        passwordHash,
        role: 'admin',
      }),
    );
    adminId = admin.id;

    const user = await userRepo.save(
      userRepo.create({
        email: USER_EMAIL,
        passwordHash,
        role: 'user',
      }),
    );
    userId = user.id;

    // Log in each account to capture a real access JWT.
    const adminLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: ADMIN_EMAIL, password: PASSWORD });
    adminAccessToken = adminLogin.body.accessToken;

    const userLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: USER_EMAIL, password: PASSWORD });
    userAccessToken = userLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  describe('GET /v1/admin/models', () => {
    it('returns 401 for an anonymous request', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/models');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_token');
    });

    it('returns 403 for a regular user (authenticated but not admin)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${userAccessToken}`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('returns 200 for an admin user', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${adminAccessToken}`);
      expect(res.status).toBe(200);
      // The route returns { items: ModelAdmin[] } — see T009 (US7).
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('returns 401 for a tampered JWT (signature check fails before role check)', async () => {
      const tampered = adminAccessToken.slice(0, -3) + 'XYZ';
      const res = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${tampered}`);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('invalid_token');
    });
  });
});
