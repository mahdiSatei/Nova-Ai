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
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import { ProviderFailoverService } from '../../src/modules/provider/provider-failover.service';

/** Builds a minimal valid single-page PDF with the given text line. */
function buildSimplePdf(text: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = body.length;
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (const off of offsets) {
    xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += xref + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body, 'latin1');
}

/** Parses a full buffered SSE response into { event, data } objects. */
function parseSse(text: string): Array<{ event?: string; data: any }> {
  return text
    .split('\n\n')
    .filter((raw) => raw.trim().length > 0)
    .map((raw) => {
      let eventName: string | undefined;
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      const payload = dataLines.join('\n');
      return { event: eventName, data: payload ? JSON.parse(payload) : {} };
    });
}

/**
 * Integration test: attaching an uploaded file to POST /v1/chat/stream.
 * Provider and MinIO are mocked at their client boundaries; PDF text
 * extraction runs for real against a generated fixture.
 */
describe('Files attach to chat — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let tokenA: string;
  let tokenB: string;
  let uploadedFileId: string;
  let streamSpy: jest.Mock;
  let pdfBuffer: Buffer;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-attach-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
    delete process.env.STORAGE_BUCKET;

    pdfBuffer = buildSimplePdf('The capital of France is Paris.');

    streamSpy = jest.fn(async (_provider: unknown, _params: unknown) =>
      (async function* () {
        yield { choices: [{ delta: { content: 'Paris.' } }] } as any;
      })(),
    );

    const fakeConnection = {
      provider: { id: 'attach-provider', baseUrl: 'http://localhost:9999' },
      adapter: { stream: streamSpy },
    };

    const minio = {
      bucketExists: jest.fn(() => Promise.resolve(true)),
      makeBucket: jest.fn(() => Promise.resolve()),
      putObject: jest.fn(() => Promise.resolve('etag')),
      presignedGetObject: jest.fn(() => Promise.resolve('http://signed')),
      getObject: jest.fn((_bucket: string, _key: string) =>
        Promise.resolve(
          (() => {
            const { Readable } = require('stream');
            const s = new Readable({ read() {} });
            s.push(pdfBuffer);
            s.push(null);
            return s;
          })(),
        ),
      ),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MINIO_CLIENT)
      .useValue(minio)
      .overrideProvider(ProviderRuntimeService)
      .useValue({
        assertReady: jest.fn().mockResolvedValue(fakeConnection),
        stream: jest.fn((connection: typeof fakeConnection, params: unknown) =>
          connection.adapter.stream(connection.provider, params),
        ),
      })
      // The real failover layer is exercised by chat.stream / provider-fallback
      // e2e; here it only needs to hand back the serving model so the attachment
      // assertions observe exactly one consumed provider stream.
      .overrideProvider(ProviderFailoverService)
      .useValue({
        establish: jest.fn(async (input: { model: unknown }) => ({
          model: input.model,
          connection: fakeConnection,
          stream: (async function* () {
            /* unused: ChatService opens the consumed stream via runtime.stream */
          })(),
          attempts: 1,
          failures: [],
        })),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    const { Provider } = await import('../../src/modules/provider/entities/provider.entity');
    await ds.getRepository(Provider).save({
      id: 'attach-provider',
      name: 'Attach Provider',
      type: 'openai-compatible',
      baseUrl: 'http://localhost:9999',
      apiKeyEncrypted: Buffer.from('test-api-key').toString('base64'),
      isActive: true,
      lastValidatedAt: null,
    } as any);

    const { Model } = await import('../../src/modules/models/entities/model.entity');
    await ds.getRepository(Model).save({
      id: 'model-1',
      displayName: 'Test Model',
      actualName: 'test-model-v1',
      providerId: 'attach-provider',
      visibility: 'public',
      enabled: true,
      isDefault: true,
    } as any);

    const { AppConfig } = await import('../../src/modules/app-config/entities/app-config.entity');
    const cfgRepo = ds.getRepository(AppConfig);
    const cfg = await cfgRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = 'model-1';
      await cfgRepo.save(cfg);
    }

    for (const [username, email] of [
      ['attach_a', 'attach-a@example.com'],
      ['attach_b', 'attach-b@example.com'],
    ] as const) {
      const reg = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ username, email, password: 'correct-horse-battery-staple' });
      if (email.endsWith('a@example.com')) tokenA = reg.body.accessToken;
      else tokenB = reg.body.accessToken;
    }

    const upload = await request(app.getHttpServer())
      .post('/v1/files/upload')
      .set('Authorization', `Bearer ${tokenA}`)
      .attach('file', pdfBuffer, 'report.pdf');
    uploadedFileId = upload.body.id;
    expect(uploadedFileId).toEqual(expect.any(String));
  });

  afterAll(async () => {
    if (app) await app.close();
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* temp file already gone */
    }
  });

  it('injects the extracted file content into the attached turn only', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'Summarize this', fileId: uploadedFileId });

    expect(res.status).toBe(200);
    // eslint-disable-next-line no-console
    console.log('SSE_TEXT', JSON.stringify(res.text).slice(0, 400));
    const events = parseSse(res.text);
    const deltas = events
      .filter((e) => !e.event)
      .map((e) => e.data.delta)
      .join('');
    expect(deltas).toBe('Paris.');
    expect(events[events.length - 1].event).toBe('done');

    expect(streamSpy).toHaveBeenCalledTimes(1);
    const call = streamSpy.mock.calls[0][1] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages).toEqual([
      { role: 'user', content: expect.stringContaining('The capital of France is Paris.') },
    ]);
    expect(call.messages[0].content).toContain('[Attached file: report.pdf');
    expect(call.messages[0].content).toContain('Summarize this');
  });

  it('rejects attaching a file owned by another user', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'hi', fileId: uploadedFileId });

    expect(res.status).toBe(200);
    const events = parseSse(res.text);
    expect(events).toEqual([
      { event: 'error', data: { code: 'file_not_found', message: expect.any(String) } },
    ]);
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown fileId', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Accept', 'text/event-stream')
      .send({ message: 'hi', fileId: '00000000-0000-4000-8000-000000000000' });

    const events = parseSse(res.text);
    expect(events).toEqual([
      { event: 'error', data: { code: 'file_not_found', message: expect.any(String) } },
    ]);
  });

  it('surfaces a malformed fileId as an SSE error frame (SSE routes stream pipe errors)', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/chat/stream')
      .set("Authorization", `Bearer ${tokenA}`).set("Accept", "text/event-stream")
      .send({ message: 'hi', fileId: 'not-a-uuid' });

    // @Sse() routes always respond 200; validation failures arrive as an
    // error frame inside the stream instead of an HTTP 400.
    expect(res.status).toBe(200);
    expect(res.text).toContain('event: error');
    expect(res.text).toContain('Bad Request');
  });
});
