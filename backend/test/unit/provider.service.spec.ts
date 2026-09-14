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
    it('refuses to persist when the probe returns 401 (prior config untouched)', async () => {
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
