import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { CentralProvider } from '../../src/modules/provider/entities/central-provider.entity';
import { ProviderService } from '../../src/modules/provider/provider.service';

const TEST_KEY = Buffer.alloc(32, 0x42).toString('base64');

describe('ProviderService', () => {
  let svc: ProviderService;
  let repo: any;
  let fetchSpy: jest.SpyInstance;

  beforeAll(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = TEST_KEY;
  });

  beforeEach(async () => {
    const rows: CentralProvider[] = [];
    repo = {
      findOne: jest.fn(({ where }: any) => {
        if (!where) return null;
        if (where.id === 'singleton') return rows.find((r) => r.id === 'singleton') ?? null;
        return rows.find((r) => r.id === where.id) ?? null;
      }),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn(async (entity: any) => {
        if (!entity.id) entity.id = 'singleton';
        const idx = rows.findIndex((r) => r.id === entity.id);
        if (idx >= 0) rows[idx] = entity;
        else rows.push(entity);
        return entity;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        { provide: getRepositoryToken(CentralProvider), useValue: repo },
      ],
    }).compile();

    svc = moduleRef.get(ProviderService);

    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('read()', () => {
    it('returns isConfigured:false when no row exists', async () => {
      const result = await svc.read();
      expect(result).toEqual({ isConfigured: false });
    });

    it('returns the public shape with the credential masked (last 4 chars)', async () => {
      const { encrypt } = await import('../../src/common/crypto/credential-cipher');
      const row = repo.create({
        id: 'singleton',
        baseUrl: 'https://api.example.com/v1',
        apiKeyEncrypted: encrypt('sk-my-very-secret-key-1234'),
        lastValidatedAt: new Date('2026-09-14T00:00:00Z'),
      });
      await repo.save(row);

      const result = await svc.read();
      expect(result.isConfigured).toBe(true);
      expect((result as any).baseUrl).toBe('https://api.example.com/v1');
      expect((result as any).apiKeyMasked).toBe('***1234');
      expect((result as any).lastValidatedAt).toBe('2026-09-14T00:00:00.000Z');
    });
  });

  describe('readOrThrow()', () => {
    it('throws NotFoundException when nothing is configured', async () => {
      await expect(svc.readOrThrow()).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update()', () => {
    it('refuses to persist when GET /models returns 401 (prior config untouched)', async () => {
      const { encrypt } = await import('../../src/common/crypto/credential-cipher');
      const prior = repo.create({
        id: 'singleton',
        baseUrl: 'https://api.example.com/v1',
        apiKeyEncrypted: encrypt('prior-good-key-1234'),
        lastValidatedAt: new Date('2026-09-13T00:00:00Z'),
      });
      await repo.save(prior);

      fetchSpy.mockResolvedValue(
        new Response('{"error":"invalid api key"}', { status: 401 }),
      );

      await expect(
        svc.update({ baseUrl: 'https://api.example.com/v1', apiKey: 'new-bad-key-9999' }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      const after = await svc.read();
      expect((after as any).apiKeyMasked).toBe('***1234');
      expect((after as any).lastValidatedAt).toBe('2026-09-13T00:00:00.000Z');
    });

    it('classifies GET /models 401 as credentials_rejected', async () => {
      fetchSpy.mockResolvedValue(new Response('', { status: 401 }));
      await expect(
        svc.update({ baseUrl: 'https://api.example.com/v1', apiKey: 'bad-key-1234' }),
      ).rejects.toMatchObject({
        response: { code: 'credentials_rejected' },
      });
    });

    it('persists on a successful probe', async () => {
      fetchSpy.mockResolvedValue(
        new Response('{"choices":[]}', { status: 200 }),
      );

      const result = await svc.update({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-valid-key-1234',
      });
      expect(result.isConfigured).toBe(true);
      expect(result.apiKeyMasked).toBe('***1234');
      expect(result.lastValidatedAt).toBeTruthy();
    });

    it('returns provider_unreachable on network failure (no DB write)', async () => {
      fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(
        svc.update({ baseUrl: 'https://api.invalid/v1', apiKey: 'sk-whatever-1234' }),
      ).rejects.toMatchObject({ response: { code: 'provider_unreachable' } });

      expect(await svc.read()).toEqual({ isConfigured: false });
    });
  });

  describe('probe() — via update() integration', () => {
    const BASE = 'https://api.example.com/v1';
    const KEY = 'sk-test-key-1234';

    /** Wire fetchSpy to dispatch on URL between /models and /chat/completions. */
    function routeFetch(models: Response, chat?: Response) {
      fetchSpy.mockImplementation((input: any) => {
        const url = typeof input === 'string' ? input : input?.url ?? '';
        return Promise.resolve(url.includes('/chat/completions') ? chat ?? models : models);
      });
    }

    it('persists when GET /models returns 200 (no chat-completions call needed)', async () => {
      routeFetch(new Response('{"object":"list","data":[]}', { status: 200 }));

      const result = await svc.update({ baseUrl: BASE, apiKey: KEY });
      expect(result.isConfigured).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const calledUrl = String((fetchSpy.mock.calls[0][0] as Request | string) ?? '');
      expect(calledUrl).toContain('/models');
      expect(calledUrl).not.toContain('/chat/completions');
    });

    it('classifies GET /models 401 as credentials_rejected', async () => {
      routeFetch(new Response('', { status: 401 }));
      await expect(svc.update({ baseUrl: BASE, apiKey: KEY })).rejects.toMatchObject({
        response: { code: 'credentials_rejected' },
      });
    });

    it('classifies GET /models 403 as credentials_rejected', async () => {
      routeFetch(new Response('', { status: 403 }));
      await expect(svc.update({ baseUrl: BASE, apiKey: KEY })).rejects.toMatchObject({
        response: { code: 'credentials_rejected' },
      });
    });

    it('falls back to /chat/completions when /models returns 404', async () => {
      const models = new Response('', { status: 404 });
      const chat = new Response('{"choices":[]}', { status: 200 });
      routeFetch(models, chat);

      const result = await svc.update({ baseUrl: BASE, apiKey: KEY });
      expect(result.isConfigured).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('classifies fallback /chat/completions 401 as credentials_rejected', async () => {
      const models = new Response('', { status: 404 });
      const chat = new Response('', { status: 401 });
      routeFetch(models, chat);

      await expect(svc.update({ baseUrl: BASE, apiKey: KEY })).rejects.toMatchObject({
        response: { code: 'credentials_rejected' },
      });
    });

    it('classifies fallback /chat/completions 400 as provider_request_invalid (regression)', async () => {
      // This is the user's exact bug: probe hit a real provider which
      // returned 400 to a chat call. Old code mapped 400 → credentials_rejected.
      // New code must map 400 (non-auth 4xx) → provider_request_invalid.
      const models = new Response('', { status: 404 });
      const chat = new Response('{"error":"model not found"}', { status: 400 });
      routeFetch(models, chat);

      await expect(svc.update({ baseUrl: BASE, apiKey: KEY })).rejects.toMatchObject({
        response: { code: 'provider_request_invalid' },
      });
    });

    it('classifies GET /models 500 as provider_unreachable (no fallback)', async () => {
      routeFetch(new Response('', { status: 500 }));
      await expect(svc.update({ baseUrl: BASE, apiKey: KEY })).rejects.toMatchObject({
        response: { code: 'provider_unreachable' },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1); // did NOT fall back
    });

    it('classifies fallback /chat/completions 503 as provider_unreachable', async () => {
      const models = new Response('', { status: 404 });
      const chat = new Response('', { status: 503 });
      routeFetch(models, chat);

      await expect(svc.update({ baseUrl: BASE, apiKey: KEY })).rejects.toMatchObject({
        response: { code: 'provider_unreachable' },
      });
    });
  });

  describe('getDecryptedApiKey()', () => {
    it('throws when unconfigured', async () => {
      await expect(svc.getDecryptedApiKey()).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('returns baseUrl + cleartext apiKey when configured', async () => {
      const { encrypt } = await import('../../src/common/crypto/credential-cipher');
      await repo.save(
        repo.create({
          id: 'singleton',
          baseUrl: 'https://api.example.com/v1',
          apiKeyEncrypted: encrypt('sk-valid-key-1234'),
          lastValidatedAt: null,
        }),
      );
      const result = await svc.getDecryptedApiKey();
      expect(result.baseUrl).toBe('https://api.example.com/v1');
      expect(result.apiKey).toBe('sk-valid-key-1234');
    });
  });
});
