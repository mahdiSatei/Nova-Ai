import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModelsService } from '../../src/modules/models/models.service';
import { Model } from '../../src/modules/models/entities/model.entity';

describe('ModelsService', () => {
  let svc: ModelsService;
  let repo: any;

  // Helper: build a minimal QueryBuilder-compatible mock around a list.
  function makeRepo(initial: Model[]) {
    const rows = [...initial];
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => null),
      getRawOne: jest.fn(async () => undefined),
      getRawMany: jest.fn(async () => []),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      manager: undefined as any,
    };
    return {
      find: jest.fn(async ({ where, order }: any) => {
        let out = rows;
        if (where) out = out.filter((r) => Object.entries(where).every(([k, v]) => (r as any)[k] === v));
        if (order) {
          const [field, dir] = Object.entries(order)[0] as [string, string];
          out = [...out].sort((a, b) => {
            const av = (a as any)[field];
            const bv = (b as any)[field];
            if (av < bv) return dir === 'ASC' ? -1 : 1;
            if (av > bv) return dir === 'ASC' ? 1 : -1;
            return 0;
          });
        }
        return out;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        const found = rows.find((r) => Object.entries(where).every(([k, v]) => (r as any)[k] === v));
        return found ?? null;
      }),
      create: jest.fn((dto: any) => ({ ...dto, id: 'm-new', createdAt: new Date(), updatedAt: new Date(), isDefault: false })),
      save: jest.fn(async (entity: any) => {
        const idx = rows.findIndex((r) => r.id === entity.id);
        if (idx >= 0) rows[idx] = { ...rows[idx], ...entity };
        else rows.push({ ...entity });
        return rows.find((r) => r.id === entity.id) ?? rows[rows.length - 1];
      }),
      delete: jest.fn(async ({ id }: any) => {
        const idx = rows.findIndex((r) => r.id === id);
        if (idx >= 0) rows.splice(idx, 1);
        return { affected: idx >= 0 ? 1 : 0 };
      }),
      createQueryBuilder: jest.fn(() => qb),
      manager: undefined as any,
      __rows: rows,
      __qb: qb,
      __setRows: (next: Model[]) => { rows.length = 0; rows.push(...next); },
    };
  }

  beforeEach(async () => {
    repo = makeRepo([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: getRepositoryToken(Model), useValue: repo },
      ],
    }).compile();

    svc = moduleRef.get(ModelsService);

    // Wire the manager-based queries back to repo so createQueryBuilder().manager.X works.
    const qb = repo.createQueryBuilder();
    qb.manager = {
      createQueryBuilder: () => qb,
    };
    repo.manager = qb.manager;
  });

  describe('create()', () => {
    it('creates a model with default enabled=true', async () => {
      const m = await svc.create({ displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini' });
      expect(m.displayName).toBe('GPT-4o mini');
      expect(m.actualName).toBe('gpt-4o-mini');
      expect(m.enabled).toBe(true);
      expect(m.isDefault).toBe(false);
    });

    it('rejects a duplicate display name (case-insensitive)', async () => {
      await svc.create({ displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini' });
      // Reset repo with the saved row so the second create hits the dup check.
      const saved = (repo.save as jest.Mock).mock.results[0].value;
      repo.__setRows([saved]);
      repo.__qb.getOne.mockResolvedValue(saved);

      await expect(
        svc.create({ displayName: 'gpt-4o MINI', actualName: 'other-model' }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update()', () => {
    it('clears isDefault when the default model is disabled', async () => {
      const row: Model = {
        id: 'm1',
        displayName: 'A',
        actualName: 'a',
        enabled: true,
        isDefault: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Model;
      repo.__setRows([row]);
      repo.__qb.getOne.mockResolvedValue(null); // displayName uniqueness check: no other model has this name

      const updated = await svc.update('m1', { enabled: false });
      expect(updated.enabled).toBe(false);
      expect(updated.isDefault).toBe(false); // invariant: disabled model can't be default
    });

    it('rejects a duplicate display name on rename', async () => {
      const a: Model = { id: 'm1', displayName: 'A', actualName: 'a', enabled: true, isDefault: false, createdAt: new Date(), updatedAt: new Date() } as Model;
      const b: Model = { id: 'm2', displayName: 'B', actualName: 'b', enabled: true, isDefault: false, createdAt: new Date(), updatedAt: new Date() } as Model;
      repo.__setRows([a, b]);
      // Simulate the dup check returning the OTHER model.
      repo.__qb.getOne.mockResolvedValue(b);

      await expect(svc.update('m1', { displayName: 'B' })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('delete()', () => {
    it('refuses with 409 when the model is the current default', async () => {
      const row: Model = { id: 'm1', displayName: 'A', actualName: 'a', enabled: true, isDefault: true, createdAt: new Date(), updatedAt: new Date() } as Model;
      repo.__setRows([row]);
      // First call: app_config (default_model_id = 'm1'); second would be COUNT.
      repo.__qb.getRawOne.mockResolvedValueOnce({ default_model_id: 'm1' });

      await expect(svc.delete('m1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses with 409 when conversations reference the model', async () => {
      const row: Model = { id: 'm1', displayName: 'A', actualName: 'a', enabled: true, isDefault: false, createdAt: new Date(), updatedAt: new Date() } as Model;
      repo.__setRows([row]);
      repo.__qb.getRawOne
        .mockResolvedValueOnce({ default_model_id: null })
        .mockResolvedValueOnce({ c: '3' });

      await expect(svc.delete('m1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('deletes successfully when neither default nor referenced', async () => {
      const row: Model = { id: 'm1', displayName: 'A', actualName: 'a', enabled: true, isDefault: false, createdAt: new Date(), updatedAt: new Date() } as Model;
      repo.__setRows([row]);
      repo.__qb.getRawOne
        .mockResolvedValueOnce({ default_model_id: null })
        .mockResolvedValueOnce({ c: '0' });

      await svc.delete('m1');
      expect(repo.delete).toHaveBeenCalledWith('m1');
    });
  });
});
