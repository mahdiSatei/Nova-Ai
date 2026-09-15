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
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';

describe('Models admin CRUD (US7) — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let adminToken: string;
  let userToken: string;

  const ADMIN_EMAIL = 'admin-models@example.com';
  const USER_EMAIL = 'user-models@example.com';
  const PASSWORD = 'correct-horse-battery-staple';

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-models-admin-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
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
      .send({ email: ADMIN_EMAIL, password: PASSWORD });
    adminToken = adminLogin.body.accessToken;

    const userLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ email: USER_EMAIL, password: PASSWORD });
    userToken = userLogin.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  beforeEach(async () => {
    const ds = app.get(DataSource);
    await ds.query('DELETE FROM conversations');
    await ds.query('DELETE FROM models');
    const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = null;
      await ds.getRepository(AppConfig).save(cfg);
    }
  });

  describe('GET /v1/admin/models', () => {
    it('returns an empty list when no models exist', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('returns 403 for a regular user', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(403);
    });

    it('returns 401 with no token', async () => {
      const res = await request(app.getHttpServer()).get('/v1/admin/models');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/admin/models', () => {
    it('creates a model with default enabled=true', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini' });

      expect(res.status).toBe(201);
      expect(res.body.displayName).toBe('GPT-4o mini');
      expect(res.body.actualName).toBe('gpt-4o-mini');
      expect(res.body.enabled).toBe(true);
      expect(res.body.isDefault).toBe(false);
    });

    it('rejects duplicate display name with 409', async () => {
      await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'Duplicate', actualName: 'a' })
        .expect(201);

      const dup = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'Duplicate', actualName: 'b' });

      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('display_name_taken');
    });

    it('rejects oversized displayName with 400', async () => {
      const tooLong = 'x'.repeat(81);
      const res = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: tooLong, actualName: 'gpt-4o-mini' });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /v1/admin/models/:id', () => {
    let modelId: string;
    beforeEach(async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'Editable', actualName: 'gpt-editable' });
      modelId = created.body.id;
    });

    it('updates the displayName', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/models/${modelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'Renamed' });
      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe('Renamed');
    });

    it('disables a model and clears isDefault atomically', async () => {
      const ds = app.get(DataSource);
      const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
      cfg!.defaultModelId = modelId;
      await ds.getRepository(AppConfig).save(cfg!);
      await ds.query('UPDATE models SET is_default = 1 WHERE id = ?', [modelId]);

      const res = await request(app.getHttpServer())
        .patch(`/v1/admin/models/${modelId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false });

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.isDefault).toBe(false);
    });

    it('returns 404 when the model does not exist', async () => {
      const res = await request(app.getHttpServer())
        .patch('/v1/admin/models/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'X' });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /v1/admin/models/:id', () => {
    let modelId: string;
    beforeEach(async () => {
      const created = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'ToDelete', actualName: 'gpt-todelete' });
      modelId = created.body.id;
    });

    it('deletes an unreferenced model', async () => {
      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${modelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(204);

      const list = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.body.items.find((m: any) => m.id === modelId)).toBeUndefined();
    });

    it('refuses with 409 when the model is the current default', async () => {
      const ds = app.get(DataSource);
      const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
      cfg!.defaultModelId = modelId;
      await ds.getRepository(AppConfig).save(cfg!);

      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${modelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('model_in_use');
    });

    it('409 message reports the reference counts', async () => {
      const ds = app.get(DataSource);
      const { id: userId } = (
        await ds.query('SELECT id FROM users WHERE email = ?', [USER_EMAIL])
      )[0];
      await ds.query(
        'INSERT INTO conversations (id, user_id, model_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['conv-count-1', userId, modelId, 't', new Date().toISOString(), new Date().toISOString()],
      );

      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${modelId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('model_in_use');
      expect(del.body.message).toContain('1 conversation(s)');
    });
  });

  describe('DELETE /v1/admin/models/:id?migrateTo — safe migration', () => {
    let oldId: string;
    let replId: string;

    async function seedReferences(): Promise<string> {
      const ds = app.get(DataSource);
      const { id: userId } = (
        await ds.query('SELECT id FROM users WHERE email = ?', [USER_EMAIL])
      )[0];
      await ds.query(
        'INSERT INTO conversations (id, user_id, model_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        ['conv-mig-1', userId, oldId, 'migrated chat', new Date().toISOString(), new Date().toISOString()],
      );
      await ds.query('UPDATE users SET last_selected_model_id = ? WHERE id = ?', [oldId, userId]);
      const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
      cfg!.defaultModelId = oldId;
      await ds.getRepository(AppConfig).save(cfg!);
      await ds.query('UPDATE models SET is_default = 1 WHERE id = ?', [oldId]);
      return userId;
    }

    beforeEach(async () => {
      const old = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'OldModel', actualName: 'old-model-v1' });
      oldId = old.body.id;
      const repl = await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'ReplModel', actualName: 'repl-model-v1' });
      replId = repl.body.id;
    });

    it('re-points conversations, users and the default, then deletes — 200 with counts', async () => {
      const userId = await seedReferences();

      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${oldId}?migrateTo=${replId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(200);
      expect(del.body.deleted).toBe(true);
      expect(del.body.migrated).toEqual({ conversations: 1, users: 1, defaultSwitched: true });

      const ds = app.get(DataSource);
      const conv = (await ds.query('SELECT model_id FROM conversations WHERE id = ?', ['conv-mig-1']))[0];
      expect(conv.model_id).toBe(replId);
      const user = (await ds.query('SELECT last_selected_model_id AS m FROM users WHERE id = ?', [userId]))[0];
      expect(user.m).toBe(replId);
      const cfg = await ds.getRepository(AppConfig).findOne({ where: { id: 'singleton' } });
      expect(cfg!.defaultModelId).toBe(replId);
      const flags = await ds.query('SELECT id, is_default FROM models ORDER BY id');
      expect(flags.find((r: any) => r.id === replId)!.is_default).toBe(1);
      expect(flags.find((r: any) => r.id === oldId)).toBeUndefined();

      // The old model is gone from both admin and public surfaces.
      const adminList = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminList.body.items.map((m: any) => m.id)).not.toContain(oldId);
      const pubList = await request(app.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${userToken}`);
      expect(pubList.body.items.map((m: any) => m.id)).not.toContain(oldId);
    });

    it('the chatbot keeps working on the old conversation after migration (step: verify, not force)', async () => {
      await seedReferences();
      await request(app.getHttpServer())
        .delete(`/v1/admin/models/${oldId}?migrateTo=${replId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Continue the migrated conversation WITHOUT an explicit modelId:
      // resolution must fall through sticky→replacement/default and the
      // SSE contract must hold (provider unconfigured yields an SSE error
      // event, but the stream itself must open).
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${userToken}`)
        .set('Accept', 'text/event-stream')
        .send({ conversationId: 'conv-mig-1', message: 'continue please' });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/event-stream');
    });

    it('rejects a missing replacement with 422 and keeps the model', async () => {
      await seedReferences();
      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${oldId}?migrateTo=00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(422);
      expect(del.body.code).toBe('replacement_not_available');

      const list = await request(app.getHttpServer())
        .get('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`);
      expect(list.body.items.map((m: any) => m.id)).toContain(oldId);
    });

    it('rejects a disabled replacement with 422', async () => {
      await seedReferences();
      await request(app.getHttpServer())
        .patch(`/v1/admin/models/${replId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false })
        .expect(200);
      // disabling may not matter here since old is default; but the target
      // check runs after the default-guard is skipped via migrateTo.
      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${oldId}?migrateTo=${replId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(422);
      expect(del.body.code).toBe('replacement_not_available');
    });

    it('rejects migrating a model onto itself with 409', async () => {
      await seedReferences();
      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${oldId}?migrateTo=${oldId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(409);
      expect(del.body.code).toBe('replacement_not_available');
    });

    it('migrating an unreferenced model is a no-op migration', async () => {
      const del = await request(app.getHttpServer())
        .delete(`/v1/admin/models/${oldId}?migrateTo=${replId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(del.status).toBe(200);
      expect(del.body.migrated).toEqual({ conversations: 0, users: 0, defaultSwitched: false });
    });
  });

  describe('actualName never leaks to end-user surface', () => {
    it('GET /v1/models does not include actualName', async () => {
      await request(app.getHttpServer())
        .post('/v1/admin/models')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ displayName: 'Visible To User', actualName: 'secret-actual-name-1234' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/v1/models')
        .set('Authorization', `Bearer ${userToken}`);
      expect(res.status).toBe(200);
      const bodyText = JSON.stringify(res.body);
      expect(bodyText).not.toContain('secret-actual-name-1234');
      expect(bodyText).not.toContain('actualName');
      expect(res.body.items[0]).toEqual({
        id: expect.any(String),
        displayName: 'Visible To User',
        isDefault: false,
      });
    });
  });
});
