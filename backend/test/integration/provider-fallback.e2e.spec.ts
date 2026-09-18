import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import * as argon2 from 'argon2';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { Model } from '../../src/modules/models/entities/model.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { UsageRecord } from '../../src/modules/usage/entities/usage-record.entity';
import { Quota } from '../../src/modules/quotas/entities/quota.entity';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { encrypt } from '../../src/common/crypto/credential-cipher';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import { NormalizedProviderError } from '../../src/modules/provider/errors/normalized-provider.error';

/**
 * Provider fallback & graceful degradation — e2e (spec 006, PostgreSQL
 * `chatbot_test`).
 *
 * The provider runtime is overridden with a scripted fake so no real network
 * call is made. Per-provider behaviour is keyed by provider id, which is what
 * lets one fake drive every scenario: transient retry, terminal skip, total
 * exhaustion, and fallback.
 */

const RUN = Date.now().toString(36);
const PASSWORD = 'correct-horse-battery-staple';

const IDS = {
  downProvider: `down-prov-${RUN}`,
  upProvider: `up-prov-${RUN}`,
  commercialProvider: `com-prov-${RUN}`,
  flakyModel: randomUUID(),
  stableModel: randomUUID(),
  doomedModel: randomUUID(),
  commercialModel: randomUUID(),
};

type Behaviour =
  | { kind: 'fail'; code: string; times: number }
  | { kind: 'succeed'; content: string };

const behaviour = new Map<string, Behaviour[]>();
const callCounts = new Map<string, number>();

function script(providerId: string, ...steps: Behaviour[]) {
  behaviour.set(providerId, steps);
  callCounts.set(providerId, 0);
}

function failProvider(
  providerId: string,
): { provider: Provider; adapter: { stream: jest.Mock } } {
  return {
    provider: { id: providerId } as Provider,
    adapter: {
      stream: jest.fn(async () => {
        callCounts.set(providerId, (callCounts.get(providerId) ?? 0) + 1);
        const queue = behaviour.get(providerId) ?? [];
        const step = queue.shift() ?? { kind: 'fail' as const, code: 'provider_timeout', times: 1 };
        if (step.kind === 'fail') {
          // Match production: after phase 6 the adapter normalizes every stream
          // error, so the failover layer only ever sees stable codes.
          throw new NormalizedProviderError({
            code: step.code,
            message: 'Simulated provider failure.',
            statusCode: 504,
            originalMessage: 'simulated',
          });
        }
        return (async function* () {
          yield { choices: [{ delta: { content: step.content } }] };
          yield {
            choices: [{ delta: { content: '' } }],
            usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 },
          };
        })();
      }),
    },
  };
}

/** Drain an SSE response body into events. */
function parseSse(text: string): Array<{ event?: string; data: any }> {
  return text
    .split('\n\n')
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event: string | undefined;
      const dataLines: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
      }
      const raw = dataLines.join('\n');
      let data: any = raw;
      try {
        data = JSON.parse(raw);
      } catch {
        /* non-JSON frame */
      }
      return { event, data };
    });
}

async function streamChat(
  server: any,
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; text: string; events: Array<{ event?: string; data: any }> }> {
  const res = await request(server)
    .post('/v1/chat/stream')
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'text/event-stream')
    .send(body);
  return { status: res.status, text: res.text ?? '', events: parseSse(res.text ?? '') };
}

describe('Provider fallback — e2e (spec 006)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let userToken: string;
  let freeToken: string;
  let userId: string;
  let freeUserId: string;

  jest.setTimeout(90_000);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.POSTGRES_HOST = '127.0.0.1';
    process.env.POSTGRES_PORT = process.env.TEST_POSTGRES_PORT ?? '5432';
    process.env.POSTGRES_USER = 'postgres';
    process.env.POSTGRES_PASSWORD = process.env.TEST_POSTGRES_PASSWORD ?? 'postgres';
    process.env.POSTGRES_DB = 'chatbot_test';
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

    // Scripted per-provider behaviour. The failover service calls
    // runtime.assertReady(modelId) → provider id, then runtime.stream.
    const down = failProvider(IDS.downProvider);
    const up = failProvider(IDS.upProvider);
    const commercial = failProvider(IDS.commercialProvider);

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ProviderRuntimeService)
      .useValue({
        assertReady: jest.fn(async (modelId: string) => {
          const modelRepo = app.get(DataSource).getRepository(Model);
          const model = await modelRepo.findOne({ where: { id: modelId } });
          const providerId = model?.providerId ?? IDS.upProvider;
          if (providerId === IDS.downProvider) return down;
          if (providerId === IDS.commercialProvider) return commercial;
          return up;
        }),
        stream: jest.fn((connection: any, input: any) => connection.adapter.stream(input)),
      })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    ds = app.get(DataSource);
    await ds.runMigrations();

    const providerRepo = ds.getRepository(Provider);
    await providerRepo.save([
      providerRepo.create({
        id: IDS.downProvider,
        name: `Down Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
      providerRepo.create({
        id: IDS.upProvider,
        name: `Up Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
      providerRepo.create({
        id: IDS.commercialProvider,
        name: `Commercial Provider ${RUN}`,
        type: 'openai-compatible',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        isActive: true,
      }),
    ]);

    const modelRepo = ds.getRepository(Model);
    await modelRepo.save([
      // Primary whose provider is down; falls back to the stable model.
      modelRepo.create({
        id: IDS.flakyModel,
        displayName: `Flaky Model ${RUN}`,
        actualName: `flaky-${RUN}`,
        providerId: IDS.downProvider,
        visibility: 'public',
        enabled: true,
        fallbackModelId: IDS.stableModel,
      }),
      // Healthy fallback target.
      modelRepo.create({
        id: IDS.stableModel,
        displayName: `Stable Model ${RUN}`,
        actualName: `stable-${RUN}`,
        providerId: IDS.upProvider,
        visibility: 'public',
        enabled: true,
      }),
      // No fallback at all — for the all-unavailable scenario.
      modelRepo.create({
        id: IDS.doomedModel,
        displayName: `Doomed Model ${RUN}`,
        actualName: `doomed-${RUN}`,
        providerId: IDS.downProvider,
        visibility: 'public',
        enabled: true,
        fallbackModelId: null,
      }),
      // Commercial fallback target for the entitlement test.
      modelRepo.create({
        id: IDS.commercialModel,
        displayName: `Commercial Model ${RUN}`,
        actualName: `commercial-${RUN}`,
        providerId: IDS.commercialProvider,
        visibility: 'commercial',
        enabled: true,
      }),
    ]);

    // The entitlement case needs its own primary whose fallback is commercial.
    // Re-point the flaky model? No — use a dedicated model so the other cases
    // are unaffected.
    await modelRepo.update(
      { id: IDS.flakyModel },
      { fallbackModelId: IDS.stableModel },
    );

    const userRepo = ds.getRepository(User);
    const passwordHash = await argon2.hash(PASSWORD);
    await userRepo.save([
      userRepo.create({
        email: `fb-user-${RUN}@example.com`,
        passwordHash,
        role: 'user',
        accessTier: 'free',
      }),
      userRepo.create({
        email: `fb-free-${RUN}@example.com`,
        passwordHash,
        role: 'user',
        accessTier: 'free',
      }),
    ]);

    const login = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: `fb-user-${RUN}@example.com`, password: PASSWORD });
    userToken = login.body.accessToken;
    const freeLogin = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: `fb-free-${RUN}@example.com`, password: PASSWORD });
    freeToken = freeLogin.body.accessToken;

    userId = (await userRepo.findOne({ where: { email: `fb-user-${RUN}@example.com` } }))?.id ?? '';
    freeUserId =
      (await userRepo.findOne({ where: { email: `fb-free-${RUN}@example.com` } }))?.id ?? '';

    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = IDS.stableModel;
      await appConfigRepo.save(cfg);
    }

    // Give both users an effectively unlimited quota so token accounting
    // assertions are not confounded by phase-5 reservation limits.
    const quotaRepo = ds.getRepository(Quota);
    for (const uid of [userId, freeUserId]) {
      const existing = await quotaRepo.findOne({ where: { userId: uid } });
      if (existing) {
        existing.tokenLimit = 0;
        await quotaRepo.save(existing);
      }
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('retries the same provider once on a transient failure, then succeeds', async () => {
    script(IDS.downProvider, { kind: 'fail', code: 'provider_timeout', times: 1 }, {
      kind: 'succeed',
      content: 'recovered',
    });
    script(IDS.upProvider, { kind: 'succeed', content: 'never-called' });

    const { status, events } = await streamChat(app.getHttpServer(), userToken, {
      message: 'retry me',
      modelId: IDS.doomedModel === IDS.flakyModel ? IDS.flakyModel : IDS.flakyModel,
      conversationId: null,
    });

    expect(status).toBe(200);
    expect(events).toContainEqual({ event: 'done', data: {} });
    expect(events.some((e) => e.data?.delta === 'recovered')).toBe(true);
    expect(callCounts.get(IDS.downProvider)).toBe(2);
    expect(callCounts.get(IDS.upProvider)).toBe(0);
  });

  it('falls back to the configured model when the primary is exhausted', async () => {
    script(
      IDS.downProvider,
      { kind: 'fail', code: 'provider_timeout', times: 1 },
      { kind: 'fail', code: 'provider_timeout', times: 1 },
    );
    script(IDS.upProvider, { kind: 'succeed', content: 'from backup' });

    const { status, events } = await streamChat(app.getHttpServer(), userToken, {
      message: 'fall back for me',
      modelId: IDS.flakyModel,
      conversationId: null,
    });

    expect(status).toBe(200);
    expect(events.some((e) => e.data?.delta === 'from backup')).toBe(true);
    expect(events).toContainEqual({ event: 'done', data: {} });
    expect(callCounts.get(IDS.downProvider)).toBe(2);
    expect(callCounts.get(IDS.upProvider)).toBe(1);
  });

  it('emits a retrying status event before the re-attempt', async () => {
    script(IDS.downProvider, { kind: 'fail', code: 'provider_timeout', times: 1 }, {
      kind: 'succeed',
      content: 'second try',
    });

    const { events } = await streamChat(app.getHttpServer(), userToken, {
      message: 'status please',
      modelId: IDS.flakyModel,
      conversationId: null,
    });

    expect(events).toContainEqual({
      event: 'status',
      data: { phase: 'retrying', attempt: 2, maxAttempts: 2 },
    });
  });

  it('reports all_providers_unavailable when no fallback exists, and never leaks internals', async () => {
    script(
      IDS.downProvider,
      { kind: 'fail', code: 'credentials_rejected', times: 1 },
      { kind: 'fail', code: 'credentials_rejected', times: 1 },
    );

    const { status, events } = await streamChat(app.getHttpServer(), userToken, {
      message: 'fail completely',
      modelId: IDS.doomedModel,
      conversationId: null,
    });

    expect(status).toBe(200);
    const error = events.find((e) => e.event === 'error');
    expect(error?.data?.code).toBe('all_providers_unavailable');
    expect(String(error?.data?.message)).not.toMatch(/localhost|9999|sk-|baseUrl|apiKey/i);

    // The assistant message is failed exactly once, with no partial content.
    const list = await request(app.getHttpServer())
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const conv = list.body.items[0];
    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const assistant = detail.body.messages.filter((m: any) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].status).toBe('failed');
    expect(assistant[0].content).toBe('');
  });

  it('creates exactly one assistant message when a fallback served the request', async () => {
    script(
      IDS.downProvider,
      { kind: 'fail', code: 'provider_timeout', times: 1 },
      { kind: 'fail', code: 'provider_timeout', times: 1 },
    );
    script(IDS.upProvider, { kind: 'succeed', content: 'one message only' });

    const { events } = await streamChat(app.getHttpServer(), userToken, {
      message: 'single message check',
      modelId: IDS.flakyModel,
      conversationId: null,
    });

    expect(events).toContainEqual({ event: 'done', data: {} });

    const list = await request(app.getHttpServer())
      .get('/v1/conversations')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const conv = list.body.items[0];
    const detail = await request(app.getHttpServer())
      .get(`/v1/conversations/${conv.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    const assistant = detail.body.messages.filter((m: any) => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].status).toBe('completed');
    expect(assistant[0].content).toBe('one message only');
  });

  it('records the effective model and true attempt count on the usage record', async () => {
    script(
      IDS.downProvider,
      { kind: 'fail', code: 'provider_timeout', times: 1 },
      { kind: 'fail', code: 'provider_timeout', times: 1 },
    );
    script(IDS.upProvider, { kind: 'succeed', content: 'accounted' });

    await streamChat(app.getHttpServer(), userToken, {
      message: 'account for me',
      modelId: IDS.flakyModel,
      conversationId: null,
    });

    const usageRepo = ds.getRepository(UsageRecord);
    const record = await usageRepo.findOne({
      where: { conversationId: (await newestConversationId()) ?? '' },
      order: { createdAt: 'DESC' },
    });
    expect(record).toBeDefined();
    expect(record?.modelId).toBe(IDS.stableModel);
    expect(record?.providerId).toBe(IDS.upProvider);
    expect(record?.attempts).toBe(3);
    expect(record?.status).toBe('completed');
    expect(record?.totalTokens).toBe(7);
  });

  it('records a failed usage row with attempts when every candidate is exhausted', async () => {
    script(
      IDS.downProvider,
      { kind: 'fail', code: 'provider_timeout', times: 1 },
      { kind: 'fail', code: 'provider_timeout', times: 1 },
    );

    await streamChat(app.getHttpServer(), userToken, {
      message: 'count the failure',
      modelId: IDS.doomedModel,
      conversationId: null,
    });

    const usageRepo = ds.getRepository(UsageRecord);
    const record = await usageRepo.findOne({
      where: { conversationId: (await newestConversationId()) ?? '' },
      order: { createdAt: 'DESC' },
    });
    expect(record).toBeDefined();
    expect(record?.modelId).toBe(IDS.doomedModel);
    expect(record?.attempts).toBe(2);
    expect(record?.status).toBe('failed');
    expect(record?.totalTokens).toBe(0);
  });

  it('never bypasses entitlement: an unentitled fallback yields all_providers_unavailable', async () => {
    // The commercial model's provider succeeds, but the user is not entitled
    // to it. Re-point the flaky model's fallback at the commercial model.
    const modelRepo = ds.getRepository(Model);
    await modelRepo.update({ id: IDS.flakyModel }, { fallbackModelId: IDS.commercialModel });

    script(IDS.downProvider, { kind: 'fail', code: 'provider_timeout', times: 1 }, {
      kind: 'fail',
      code: 'provider_timeout',
      times: 1,
    });
    script(IDS.commercialProvider, { kind: 'succeed', content: 'secret commercial answer' });

    try {
      const { events } = await streamChat(app.getHttpServer(), userToken, {
        message: 'entitlement check',
        modelId: IDS.flakyModel,
        conversationId: null,
      });

      const error = events.find((e) => e.event === 'error');
      expect(error?.data?.code).toBe('all_providers_unavailable');
      // The commercial provider was never invoked for this free-tier user.
      expect(callCounts.get(IDS.commercialProvider) ?? 0).toBe(0);
    } finally {
      // Restore for any later case.
      await modelRepo.update({ id: IDS.flakyModel }, { fallbackModelId: IDS.stableModel });
    }
  });

  it('leaves the user quota unchanged after a total failure (reservation refunded)', async () => {
    script(
      IDS.downProvider,
      { kind: 'fail', code: 'provider_timeout', times: 1 },
      { kind: 'fail', code: 'provider_timeout', times: 1 },
    );

    const quotaRepo = ds.getRepository(Quota);
    // Make sure a quota row exists with a real limit so reservation/refund is
    // observable, then snapshot tokenUsed.
    const existing = await quotaRepo.findOne({ where: { userId } });
    if (!existing) {
      await quotaRepo.save(quotaRepo.create({ userId, tokenLimit: 1000000, tokenUsed: 0 }));
    }
    const before = (await quotaRepo.findOne({ where: { userId } }))?.tokenUsed ?? 0;

    await streamChat(app.getHttpServer(), userToken, {
      message: 'refund check',
      modelId: IDS.doomedModel,
      conversationId: null,
    });

    const after = (await quotaRepo.findOne({ where: { userId } }))?.tokenUsed ?? 0;
    expect(Number(after)).toBe(Number(before));
  });

  /** Newest conversation for the primary user (most recent turn). */
  async function newestConversationId(): Promise<string | null> {
    const rows = await ds.query(
      `SELECT id FROM conversations WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
      [userId],
    );
    return rows[0]?.id ?? null;
  }
});
