import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ModelsService } from '../../src/modules/models/models.service';
import { Model } from '../../src/modules/models/entities/model.entity';

describe('ModelsService', () => {
  let svc: ModelsService;
  let repo: {
    find: jest.Mock;
    findOne: jest.Mock;
    manager: {
      createQueryBuilder: jest.Mock;
    };
  };

  beforeEach(async () => {
    repo = {
      find: jest.fn(),
      findOne: jest.fn(),
      manager: {
        createQueryBuilder: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          getRawOne: jest.fn().mockResolvedValue(null),
        })),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ModelsService,
        { provide: getRepositoryToken(Model), useValue: repo },
      ],
    }).compile();

    svc = moduleRef.get(ModelsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── listEnabled ───────────────────────────────────────────────────────

  describe('listEnabled', () => {
    it('returns only enabled models ordered by displayName ASC', async () => {
      const models = [
        { id: 'm2', displayName: 'Beta', enabled: true },
        { id: 'm1', displayName: 'Alpha', enabled: true },
        { id: 'm3', displayName: 'Gamma', enabled: false },
      ] as unknown as Model[];

      repo.find.mockResolvedValue(models);

      const result = await svc.listEnabled();

      expect(repo.find).toHaveBeenCalledWith({
        where: { enabled: true },
        order: { displayName: 'ASC' },
      });
      expect(result).toEqual(models);
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the model when found', async () => {
      const model = { id: 'm-1', displayName: 'Test' } as Model;
      repo.findOne.mockResolvedValue(model);

      const result = await svc.findById('m-1');
      expect(result).toBe(model);
      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'm-1' } });
    });

    it('throws NotFoundException with code when model does not exist', async () => {
      repo.findOne.mockResolvedValue(null);

      try {
        await svc.findById('missing');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(NotFoundException);
        expect((err as any).getResponse()).toMatchObject({ code: 'model_not_found' });
      }
    });
  });

  // ─── resolveActiveModel ────────────────────────────────────────────────

  describe('resolveActiveModel', () => {
    const mkModel = (overrides: Partial<Model> = {}): Model =>
      ({
        id: overrides.id ?? 'm-1',
        displayName: overrides.displayName ?? 'Model',
        enabled: overrides.enabled ?? true,
        isDefault: overrides.isDefault ?? false,
        actualName: overrides.actualName ?? 'gpt-4',
        createdAt: new Date(),
        updatedAt: new Date(),
        conversations: [],
      } as Model);

    // Helper: set up query builder mocks. Each call to
    // createQueryBuilder returns an independent chain so the user
    // and app_config queries don't share state.
    const mockQueryBuilder = (userRow: Record<string, string> | null, appConfigRow: Record<string, string> | null) => {
      const userQb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(userRow),
      };
      const acQb = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(appConfigRow),
      };

      let callIdx = 0;
      repo.manager.createQueryBuilder.mockImplementation(() => (++callIdx === 1 ? userQb : acQb));
    };

    it('resolves explicitModelId first (enabled)', async () => {
      repo.findOne.mockResolvedValue(mkModel({ id: 'explicit-id' }));
      const result = await svc.resolveActiveModel({ explicitModelId: 'explicit-id' });
      expect(result?.id).toBe('explicit-id');
    });

    it('returns null for explicitModelId when model not found', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await svc.resolveActiveModel({ explicitModelId: 'missing' });
      expect(result).toBeNull();
    });

    it('falls back to sticky user choice when no explicitModelId', async () => {
      const stickyModel = mkModel({ id: 'sticky-id' });
      mockQueryBuilder(
        { last_selected_model_id: 'sticky-id' },
        null,
      );
      repo.findOne.mockResolvedValue(stickyModel);

      const result = await svc.resolveActiveModel({ userId: 'user-1' });
      expect(result?.id).toBe('sticky-id');
    });

    it('ignores sticky choice when the model is disabled', async () => {
      mockQueryBuilder(
        { last_selected_model_id: 'disabled-id' },
        null,
      );
      // findOne returns null because enabled=true filter
      repo.findOne.mockResolvedValue(null);

      const result = await svc.resolveActiveModel({ userId: 'user-1' });
      // Should fall through to app_config / null
      expect(result).toBeNull();
    });

    it('falls back to admin default when no sticky choice', async () => {
      const defaultModel = mkModel({ id: 'default-id' });
      mockQueryBuilder(null, { default_model_id: 'default-id' });
      repo.findOne.mockResolvedValue(defaultModel);

      const result = await svc.resolveActiveModel({ userId: 'user-1' });
      expect(result?.id).toBe('default-id');
    });

    it('returns null when nothing is resolvable', async () => {
      mockQueryBuilder(null, null);
      const result = await svc.resolveActiveModel({ userId: 'user-1' });
      expect(result).toBeNull();
    });

    it('returns null when userId is not provided and no explicitModelId', async () => {
      const result = await svc.resolveActiveModel({});
      expect(result).toBeNull();
    });
  });
});
