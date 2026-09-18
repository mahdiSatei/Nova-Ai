import { randomUUID } from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Model } from '../../src/modules/models/entities/model.entity';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';

/**
 * Public model catalogue — PostgreSQL (`chatbot_test`).
 *
 * All fixtures are suffixed with a per-run token and every assertion is scoped
 * to this suite's ids, so the suite is repeatable against a persistent
 * database shared with the other integration suites.
 */
describe('Models (public) — e2e', () => {
  let app: INestApplication;
  let accessToken: string;

  const RUN = Date.now().toString(36);
  const PROVIDER_ID = `mpub-prov-${RUN}`;
  const M1 = randomUUID();
  const M2 = randomUUID();
  const M3 = randomUUID();
  const MINE = [M1, M2, M3];

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

    // Models now require a provider (NOT NULL FK), so seed one first.
    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save(
      providerRepo.create({
        id: PROVIDER_ID,
        name: `Public Models Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    );

    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      modelRepo.create({
        id: M1,
        displayName: `GPT-4o ${RUN}`,
        actualName: `gpt-4o-${RUN}`,
        providerId: PROVIDER_ID,
        enabled: true,
        isDefault: true,
      }),
      modelRepo.create({
        id: M2,
        displayName: `GPT-4o mini ${RUN}`,
        actualName: `gpt-4o-mini-${RUN}`,
        providerId: PROVIDER_ID,
        enabled: true,
        isDefault: false,
      }),
      modelRepo.create({
        id: M3,
        displayName: `Disabled Model ${RUN}`,
        actualName: `disabled-model-${RUN}`,
        providerId: PROVIDER_ID,
        enabled: false,
        isDefault: false,
      }),
    ]);

    // Register + login to get a token for protected endpoints.
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        username: `mpub_user_${RUN}`,
        email: `model-e2e-${RUN}@example.com`,
        password: 'correct-horse-battery-staple',
      });
    accessToken = reg.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('GET /v1/models — returns only enabled models with public fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);

    const mine = res.body.items.filter((i: any) => MINE.includes(i.id));
    expect(mine.map((i: any) => i.id).sort()).toEqual([M1, M2].sort());

    // actualName must not appear anywhere in our own items.
    const serialized = JSON.stringify(mine);
    expect(serialized).not.toContain(`gpt-4o-${RUN}`);
    expect(serialized).not.toContain(`gpt-4o-mini-${RUN}`);
    expect(serialized).not.toContain(`disabled-model-${RUN}`);

    // Each item must have exactly the public fields.
    for (const item of mine) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('displayName');
      expect(item).toHaveProperty('isDefault');
      expect(item).not.toHaveProperty('actualName');
      expect(item).not.toHaveProperty('enabled');
      expect(item).not.toHaveProperty('createdAt');
      expect(item).not.toHaveProperty('updatedAt');
    }
  });

  it('GET /v1/models — rejects unauthenticated requests with 401', async () => {
    const res = await request(app.getHttpServer()).get('/v1/models');
    expect(res.status).toBe(401);
  });

  it('disabled model does not appear in the list', async () => {
    // Re-query to be explicit — the first test already covers it,
    // but this documents the invariant as a separate assertion.
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${accessToken}`);
    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).not.toContain(M3);
  });

  it('isDefault flag is correctly surfaced on each model', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${accessToken}`);

    const byId = Object.fromEntries(res.body.items.map((i: any) => [i.id, i]));
    expect(byId[M1].isDefault).toBe(true);
    expect(byId[M2].isDefault).toBe(false);
  });
});
