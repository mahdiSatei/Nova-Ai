import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { MINIO_CLIENT } from '../../src/modules/files/storage.service';

/**
 * Integration test for POST /v1/files/upload.
 *
 * Full HTTP contract: auth required, type/size validation, storage
 * mocked at the MinIO client boundary so no real object store is needed.
 */
describe('Files upload — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let accessToken: string;
  let minio: {
    bucketExists: jest.Mock;
    makeBucket: jest.Mock;
    putObject: jest.Mock;
    presignedGetObject: jest.Mock;
  };

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-files-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    minio = {
      bucketExists: jest.fn(() => Promise.resolve(true)),
      makeBucket: jest.fn(() => Promise.resolve()),
      putObject: jest.fn(() => Promise.resolve('etag')),
      presignedGetObject: jest.fn(() =>
        Promise.resolve('http://localhost:9000/chat-files/signed'),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MINIO_CLIENT)
      .useValue(minio)
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({
        username: 'fileuser',
        email: 'file-user@example.com',
        password: 'correct-horse-battery-staple',
      });
    accessToken = reg.body.accessToken;
    expect(accessToken).toEqual(expect.any(String));
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* temp file already gone */
    }
  });

  it('rejects unauthenticated uploads with 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .attach('file', Buffer.from('hello'), 'a.pdf');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('invalid_token');
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects disallowed file types with 400 invalid_file_type', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('malicious'), 'evil.txt');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_file_type');
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects files over 10MB with 413 file_too_large', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 7);
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', big, 'big.pdf');

    expect(res.status).toBe(413);
    expect(res.body.code).toBe('file_too_large');
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('rejects a request with no file part', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_file');
  });

  it('stores a valid PDF and returns the file record with status UPLOADED', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${accessToken}`)
      .attach('file', Buffer.from('%PDF-fake'), 'report.pdf');

    expect(res.status).toBe(201);
    expect(res.body.id).toEqual(expect.any(String));
    expect(res.body.originalName).toBe('report.pdf');
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.size).toBe(9);
    expect(res.body.fileKey).toMatch(/\.pdf$/);
    expect(res.body.url).toBe('http://localhost:9000/chat-files/signed');
    expect(res.body.status).toBe('UPLOADED');
    expect(res.body.createdAt).toEqual(expect.any(String));

    expect(minio.putObject).toHaveBeenCalledTimes(1);
    const { ConfigService } = await import('@nestjs/config');
    const configuredBucket = app.get(ConfigService).get<string>('storage.bucket');
    expect(minio.putObject.mock.calls[0][0]).toBe(configuredBucket);

    // Record is persisted.
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id, file_key, status FROM files');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(res.body.id);
    expect(rows[0].status).toBe('UPLOADED');
  });
});
