import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * Smoke test: boot the full AppModule against the `chatbot_test` PostgreSQL
 * database and verify the health endpoints. If this passes, the foundational
 * wiring (TypeORM + entities + AuthModule + HealthModule + global
 * filter/interceptor/guards + Swagger) is sound.
 */
describe('App boot (smoke)', () => {
  let app: INestApplication;

  jest.setTimeout(60_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD = process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-to-pass';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-with-enough-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    const mod = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = mod.createNestApplication();
    await app.init();

    // Migrations are not run on boot (migrationsRun: false); apply them here
    // so the health checks see a fully provisioned schema.
    await app.get(DataSource).runMigrations();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('boots without throwing', () => {
    expect(app).toBeDefined();
  });

  it('reports healthy and ready', async () => {
    const server = app.getHttpServer();
    expect((await request(server).get('/healthz')).status).toBe(200);
    expect((await request(server).get('/readyz')).status).toBe(200);
  });
});
