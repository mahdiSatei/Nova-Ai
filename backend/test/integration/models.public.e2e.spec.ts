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

describe('Models (public) — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let accessToken: string;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-models-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
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

    // Seed a user and a couple of models via the DB directly.
    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      modelRepo.create({ id: 'm1', displayName: 'GPT-4o', actualName: 'gpt-4o', enabled: true, isDefault: true }),
      modelRepo.create({ id: 'm2', displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini', enabled: true, isDefault: false }),
      modelRepo.create({ id: 'm3', displayName: 'Disabled Model', actualName: 'disabled-model', enabled: false, isDefault: false }),
    ]);

    // Register + login to get a token for protected endpoints.
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'model-e2e@example.com', password: 'correct-horse-battery-staple' });
    accessToken = reg.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  it('GET /v1/models — returns only enabled models with public fields', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: any) => i.id).sort()).toEqual(['m1', 'm2']);

    // actualName must not appear anywhere in the response.
    expect(JSON.stringify(res.body)).not.toContain('gpt-4o');
    expect(JSON.stringify(res.body)).not.toContain('gpt-4o-mini');
    expect(JSON.stringify(res.body)).not.toContain('disabled-model');

    // Each item must have exactly the public fields.
    for (const item of res.body.items) {
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

  it('disabled model (m3) does not appear in the list', async () => {
    // Re-query to be explicit — the first test already covers it,
    // but this documents the invariant as a separate assertion.
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${accessToken}`);
    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).not.toContain('m3');
  });

  it('isDefault flag is correctly surfaced on each model', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/models')
      .set('Authorization', `Bearer ${accessToken}`);

    const byId = Object.fromEntries(res.body.items.map((i: any) => [i.id, i]));
    expect(byId['m1'].isDefault).toBe(true);
    expect(byId['m2'].isDefault).toBe(false);
  });
});
