import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ProviderService, PROVIDER_ADAPTERS } from '../../src/modules/provider/provider.service';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { encrypt, decrypt } from '../../src/common/crypto/credential-cipher';

const TEST_KEY = Buffer.alloc(32, 0x42).toString('base64');

describe('ProviderService', () => {
  let svc: ProviderService;
  let repo: any;

  beforeAll(() => {
    process.env.PROVIDER_ENCRYPTION_KEY = TEST_KEY;
  });

  beforeEach(async () => {
    const rows: Provider[] = [];
    repo = {
      find: jest.fn(async ({ order, skip, take }: any) => {
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        return sorted.slice(skip ?? 0, (skip ?? 0) + (take ?? sorted.length));
      }),
      findAndCount: jest.fn(async ({ order, skip, take }: any) => {
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name));
        const paged = sorted.slice(skip ?? 0, (skip ?? 0) + (take ?? sorted.length));
        return [paged, rows.length];
      }),
      findOne: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      create: jest.fn((dto: any) => ({ ...dto })),
      save: jest.fn(async (entity: any) => {
        if (!entity.id) entity.id = `provider-${Date.now()}`;
        const idx = rows.findIndex((r) => r.id === entity.id);
        if (idx >= 0) rows[idx] = entity;
        else rows.push(entity);
        return entity;
      }),
      delete: jest.fn(async (id: string) => {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx >= 0) rows.splice(idx, 1);
      }),
      manager: {
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue({ is_active: true }),
        })),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ProviderService,
        { provide: getRepositoryToken(Provider), useValue: repo },
        { provide: PROVIDER_ADAPTERS, useValue: [] },
      ],
    }).compile();

    svc = moduleRef.get(ProviderService);
  });

  describe('list()', () => {
    it('returns paginated providers sorted by name', async () => {
      const result = await svc.list(1, 20);
      expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });

    it('applies pagination', async () => {
      repo.save(repo.create({
        id: 'p1', name: 'Alpha', type: 'openai-compatible', baseUrl: 'https://a',
        apiKeyEncrypted: encrypt('key-a'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));
      repo.save(repo.create({
        id: 'p2', name: 'Beta', type: 'openai-compatible', baseUrl: 'https://b',
        apiKeyEncrypted: encrypt('key-b'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));

      const result = await svc.list(2, 1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].id).toBe('p2');
      expect(result.total).toBe(2);
    });
  });

  describe('read()', () => {
    it('returns provider with hasApiKey=true', async () => {
      repo.save(repo.create({
        id: 'p1', name: 'Test', type: 'openai-compatible', baseUrl: 'https://t',
        apiKeyEncrypted: encrypt('sk-key-1234'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));

      const result = await svc.read('p1');
      expect(result.id).toBe('p1');
      expect(result.name).toBe('Test');
      expect((result as any).hasApiKey).toBe(true);
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(svc.read('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create()', () => {
    it('creates provider with encrypted apiKey', async () => {
      const result = await svc.create({
        id: 'new-provider',
        name: 'New Provider',
        type: 'openai-compatible',
        baseUrl: 'https://new.example.com',
        apiKey: 'sk-new-key-1234',
      });
      expect(result.id).toBe('new-provider');
      expect(result.name).toBe('New Provider');
      expect(result.apiKeyMasked).toBe('***1234');
    });

    it('rejects duplicate names', async () => {
      repo.save(repo.create({
        id: 'p1', name: 'Existing', type: 'openai-compatible', baseUrl: 'https://e',
        apiKeyEncrypted: encrypt('key1'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));

      await expect(
        svc.create({ id: 'p2', name: 'existing', type: 'openai-compatible', baseUrl: 'https://x', apiKey: 'key2' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update()', () => {
    it('updates mutable fields', async () => {
      repo.save(repo.create({
        id: 'p1', name: 'Old', type: 'openai-compatible', baseUrl: 'https://old',
        apiKeyEncrypted: encrypt('key1'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));

      const result = await svc.update('p1', { name: 'New Name', baseUrl: 'https://new' });
      expect(result.name).toBe('New Name');
      expect(result.baseUrl).toBe('https://new');
    });
  });

  describe('delete()', () => {
    it('deletes by id', async () => {
      repo.save(repo.create({
        id: 'p1', name: 'Test', type: 'openai-compatible', baseUrl: 'https://t',
        apiKeyEncrypted: encrypt('key1'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));

      await svc.delete('p1');
      expect(repo.delete).toHaveBeenCalledWith('p1');
    });

    it('throws NotFoundException for unknown id', async () => {
      await expect(svc.delete('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getDecryptedCredential()', () => {
    it('returns decrypted credential', async () => {
      repo.save(repo.create({
        id: 'p1', name: 'Test', type: 'openai-compatible', baseUrl: 'https://t',
        apiKeyEncrypted: encrypt('sk-1234'), isActive: true, createdAt: new Date(), updatedAt: new Date(),
      }));

      const result = await svc.getDecryptedCredential('p1');
      expect(result.baseUrl).toBe('https://t');
      expect(result.apiKey).toBe('sk-1234');
    });

    it('throws when provider missing', async () => {
      await expect(svc.getDecryptedCredential('nope')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });
});
