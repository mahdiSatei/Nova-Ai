import { Test } from '@nestjs/testing';
import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModelsService } from '../../src/modules/models/models.service';
import { Model } from '../../src/modules/models/entities/model.entity';
import { ModelAccessService } from '../../src/modules/models/model-access.service';
import { ReasoningCapabilityService } from '../../src/modules/models/reasoning-capability.service';

describe('ModelsService', () => {
  let svc: ModelsService;
  let repo: any;
  let access: {
    loadViewer: jest.Mock;
    canAccess: jest.Mock;
    canAccessUser: jest.Mock;
    filterAccessible: jest.Mock;
    assertCanUseModel: jest.Mock;
  };

  // Helper: build a minimal QueryBuilder-compatible mock around a list.
  function makeRepo(initial: Model[]) {
    const rows = [...initial];
    const qb: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => null),
      getRawOne: jest.fn(async () => ({ is_active: true })),
      getRawMany: jest.fn(async () => []),
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      manager: undefined as any,
    };
    // EntityManager stand-in: getRepository(Entity).update() returns scripted
    // affected counts, delete() is recorded, counts run through the shared qb.
    const repoStubs: Record<string, { update: jest.Mock }> = {};
    const em: any = {
      createQueryBuilder: () => qb,
      // Cache one stub per entity so tests can assert the exact update a
      // transaction issued (e.g. clearing AppConfig.defaultModelId).
      getRepository: (entity: any) => {
        const name = entity?.name as string;
        if (!repoStubs[name]) {
          repoStubs[name] = {
            update: jest.fn(async () => ({
              affected: (em.__updates[name] ?? []).shift() ?? 0,
            })),
          };
        }
        return repoStubs[name];
      },
      delete: jest.fn(async () => ({ affected: 1 })),
      __updates: {} as Record<string, number[]>,
      __repoStubs: repoStubs,
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
      __em: em,
      __setRows: (next: Model[]) => { rows.length = 0; rows.push(...next); },
    };
  }

  beforeEach(async () => {
    repo = makeRepo([]);
    access = {
      loadViewer: jest.fn(),
      canAccess: jest.fn().mockReturnValue(true),
      canAccessUser: jest.fn().mockResolvedValue(true),
      filterAccessible: jest.fn(async (_userId: string, models: any[]) => models),
      assertCanUseModel: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: getRepositoryToken(Model), useValue: repo },
        { provide: ModelAccessService, useValue: access },
        {
          provide: ReasoningCapabilityService,
          useValue: {
            discover: jest.fn().mockResolvedValue({
              capability: { supported: null, output: null, streaming: null },
              sources: { supported: 'unknown', output: 'unknown', streaming: 'unknown' },
              discoveredAt: '2026-09-19T00:00:00.000Z',
            }),
          },
        },
      ],
    }).compile();

    svc = moduleRef.get(ModelsService);

    // Wire the manager-based queries back to repo so createQueryBuilder().manager.X
    // and manager.transaction(cb) work against the same scripted query builder.
    const qb = repo.createQueryBuilder();
    qb.manager = {
      createQueryBuilder: () => qb,
      transaction: (cb: any) => cb(repo.__em),
    };
    repo.manager = qb.manager;
  });

  describe('create()', () => {
    it('creates a model with default enabled=true', async () => {
      const m = await svc.create({ displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini', providerId: 'p1' });
      expect(m.displayName).toBe('GPT-4o mini');
      expect(m.actualName).toBe('gpt-4o-mini');
      expect(m.providerId).toBe('p1');
      expect(m.enabled).toBe(true);
      expect(m.isDefault).toBe(false);
    });

    it('rejects a duplicate display name (case-insensitive)', async () => {
      await svc.create({ displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini', providerId: 'p1' });
      // Reset repo with the saved row so the second create hits the dup check.
      const saved = (repo.save as jest.Mock).mock.results[0].value;
      repo.__setRows([saved]);
      repo.__qb.getOne.mockResolvedValue(saved);

      await expect(
        svc.create({ displayName: 'gpt-4o MINI', actualName: 'other-model', providerId: 'p1' }),
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

    it('clears the AppConfig default pointer when the configured default is disabled', async () => {
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
      repo.__qb.getOne.mockResolvedValue(null);
      // The enabled=false branch reads the AppConfig pointer; it names this model.
      repo.__qb.getRawOne.mockResolvedValueOnce({ default_model_id: 'm1' });
      repo.__em.__updates = { AppConfig: [1] };

      const updated = await svc.update('m1', { enabled: false });

      expect(updated.isDefault).toBe(false);
      // The runtime default pointer must be cleared too, or a re-enabled model
      // would be the runtime default while the public listing showed none.
      expect(repo.__em.__repoStubs.AppConfig.update).toHaveBeenCalledWith(
        { id: 'singleton' },
        { defaultModelId: null },
      );
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

  describe('preferred API key ownership', () => {
    it('rejects a preferred key that does not belong to the model provider on create', async () => {
      // Preferred-key lookup finds nothing for this provider.
      repo.__qb.getRawOne.mockResolvedValueOnce(undefined);

      const err = await svc
        .create({
          displayName: 'Keyed',
          actualName: 'keyed',
          providerId: 'p1',
          preferredApiKeyId: 'key-from-another-provider',
        })
        .catch((e) => e);

      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({ code: 'invalid_preferred_api_key' });
    });

    it('accepts a preferred key owned by the model provider', async () => {
      repo.__qb.getRawOne
        .mockResolvedValueOnce({ id: 'key-1' }) // preferred key belongs to p1
        .mockResolvedValueOnce({ is_active: true }); // provider active

      const created = await svc.create({
        displayName: 'Keyed',
        actualName: 'keyed',
        providerId: 'p1',
        preferredApiKeyId: 'key-1',
      });

      expect(created.preferredApiKeyId).toBe('key-1');
    });

    it('clears a stale pin when the provider changes', async () => {
      repo.__setRows([
        {
          id: 'm1',
          displayName: 'A',
          actualName: 'a',
          providerId: 'p1',
          enabled: true,
          isDefault: false,
          preferredApiKeyId: 'key-1',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ] as any);
      repo.__qb.getOne.mockResolvedValue(null);
      repo.__qb.getRawOne.mockResolvedValue({ is_active: true });

      const updated = await svc.update('m1', { providerId: 'p2' });

      expect(updated.providerId).toBe('p2');
      // The pin belonged to p1 and must not survive onto p2.
      expect(updated.preferredApiKeyId).toBeNull();
    });
  });

  describe('delete()', () => {
    const model = (id: string, over: Partial<Model> = {}): Model =>
      ({
        id,
        displayName: id,
        actualName: `actual-${id}`,
        enabled: true,
        isDefault: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }) as Model;

    // countReferences() reads: conversations COUNT, users COUNT, app_config.
    function scriptCounts(conv: string | null, users: string | null, defaultId: string | null) {
      repo.__qb.getRawOne
        .mockResolvedValueOnce(conv === null ? undefined : { c: conv })
        .mockResolvedValueOnce(users === null ? undefined : { c: users })
        .mockResolvedValueOnce(defaultId === null ? undefined : { default_model_id: defaultId });
    }

    it('refuses with 409 when the model is the current default', async () => {
      repo.__setRows([model('m1', { isDefault: true })]);
      scriptCounts('0', '0', 'm1');

      await expect(svc.delete('m1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('refuses with 409 when conversations reference the model', async () => {
      repo.__setRows([model('m1')]);
      scriptCounts('3', '0', null);

      await expect(svc.delete('m1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('refuses with 409 when only user sticky picks reference the model', async () => {
      repo.__setRows([model('m1')]);
      scriptCounts('0', '2', null);

      await expect(svc.delete('m1')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes successfully when neither default nor referenced', async () => {
      repo.__setRows([model('m1')]);
      scriptCounts('0', '0', null);

      const result = await svc.delete('m1');
      expect(result).toBeNull();
      expect(repo.delete).toHaveBeenCalledWith('m1');
    });

    it('rejects migrating a model onto itself', async () => {
      repo.__setRows([model('m1')]);
      scriptCounts('0', '0', null);

      await expect(svc.delete('m1', 'm1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a missing replacement model with 422', async () => {
      repo.__setRows([model('m1')]);
      scriptCounts('1', '0', null);

      await expect(svc.delete('m1', 'nope')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('rejects a disabled replacement model with 422', async () => {
      repo.__setRows([model('m1'), model('m2', { enabled: false })]);
      scriptCounts('1', '0', null);

      await expect(svc.delete('m1', 'm2')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('migrates references, switches the default, then deletes', async () => {
      repo.__setRows([model('m1', { isDefault: true }), model('m2')]);
      // countReferences: 3 conversations, 2 users, m1 is the app default.
      scriptCounts('3', '2', 'm1');
      // tx repository updates: conversations→3 rows, users→2, app_config→1 (default moved).
      repo.__em.__updates = { Conversation: [3], User: [2], AppConfig: [1] };
      // leftover verification: everything re-pointed away from m1.
      repo.__qb.getRawOne
        .mockResolvedValueOnce({ c: '0' })
        .mockResolvedValueOnce({ c: '0' })
        .mockResolvedValueOnce({ d: 'm2' });

      const result = await svc.delete('m1', 'm2');

      expect(result).toEqual({
        deleted: true,
        migrated: { conversations: 3, users: 2, defaultSwitched: true },
      });
      expect(repo.__em.delete).toHaveBeenCalledWith(Model, 'm1');
    });

    it('aborts (no delete) when references remain after migration updates', async () => {
      repo.__setRows([model('m1'), model('m2')]);
      scriptCounts('1', '0', null);
      repo.__em.__updates = { Conversation: [0], User: [0], AppConfig: [0] };
      // leftover conversations count still shows a reference to m1.
      repo.__qb.getRawOne.mockResolvedValueOnce({ c: '1' });

      await expect(svc.delete('m1', 'm2')).rejects.toBeInstanceOf(ConflictException);
      expect(repo.__em.delete).not.toHaveBeenCalled();
    });
  });

  describe('listAccessibleFor()', () => {
    it('returns only the enabled models the caller is entitled to, name-ordered', async () => {
      repo.__setRows([
        { id: 'priv', displayName: 'Zeta', visibility: 'private', enabled: true },
        { id: 'pub', displayName: 'Alpha', visibility: 'public', enabled: true },
        { id: 'off', displayName: 'Beta', visibility: 'public', enabled: false },
      ] as any);
      access.filterAccessible.mockImplementation(async (_userId: string, models: any[]) =>
        models.filter((m) => m.visibility !== 'private'),
      );

      const result = await svc.listAccessibleFor('u-1');

      expect(result.map((m) => m.id)).toEqual(['pub']);
      expect(access.filterAccessible).toHaveBeenCalledWith('u-1', expect.any(Array));
    });
  });

  describe('create() visibility', () => {
    it('defaults to public and stores an explicit visibility', async () => {
      const created = await svc.create({
        displayName: 'Internal',
        actualName: 'internal-1',
        providerId: 'p1',
        visibility: 'private',
      });
      expect(created.visibility).toBe('private');
    });
  });

  describe('update() visibility', () => {
    it('refuses to demote the system default away from public', async () => {
      repo.__setRows([
        { id: 'm-default', displayName: 'Default', actualName: 'd', providerId: 'p1', visibility: 'public', enabled: true, isDefault: true },
      ] as any);

      const err = await svc.update('m-default', { visibility: 'private' }).catch((e) => e);

      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toMatchObject({ code: 'model_is_default' });
    });

    it('allows demoting a non-default model', async () => {
      repo.__setRows([
        { id: 'm-plain', displayName: 'Plain', actualName: 'p', providerId: 'p1', visibility: 'public', enabled: true, isDefault: false },
      ] as any);

      const updated = await svc.update('m-plain', { visibility: 'private' });
      expect(updated.visibility).toBe('private');
    });
  });
});
