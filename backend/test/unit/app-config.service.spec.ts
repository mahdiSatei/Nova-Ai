import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { UnprocessableEntityException } from '@nestjs/common';
import { AppConfigService } from '../../src/modules/app-config/app-config.service';
import { AppConfig } from '../../src/modules/app-config/entities/app-config.entity';
import { Model } from '../../src/modules/models/entities/model.entity';

describe('AppConfigService', () => {
  let svc: AppConfigService;
  let models: Map<string, any>;
  let appConfigs: Map<string, any>;
  let modelRepo: any;

  // Shared mutable state across the EM mock and the test assertions.
  let isClear = true;
  let transactionCalls: string[] = [];

  beforeEach(async () => {
    models = new Map();
    appConfigs = new Map();
    isClear = true;
    transactionCalls = [];

    modelRepo = {
      findOne: jest.fn(async ({ where }: any) => models.get(where.id) ?? null),
    };

    // The service uses DataSource.transaction to wrap three operations.
    // We provide a tiny EntityManager-shaped mock that runs the
    // callback synchronously and inspects what it does.
    const em = {
      findOne: jest.fn(async (_entity: any, opts: any) => {
        transactionCalls.push('findOne');
        return appConfigs.get(opts.where.id) ?? null;
      }),
      save: jest.fn(async (entity: any) => {
        transactionCalls.push('save');
        appConfigs.set(entity.id, entity);
        return entity;
      }),
      create: jest.fn((_entity: any, dto: any) => {
        transactionCalls.push('create');
        return { ...dto };
      }),
      createQueryBuilder: jest.fn(() => {
        const iAmClear = isClear;
        isClear = false;
        return {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn((_sql: string, params: any) => ({
            execute: jest.fn(async () => {
              transactionCalls.push(iAmClear ? 'clearExecute' : 'setExecute');
              if (iAmClear) {
                for (const m of models.values()) m.isDefault = false;
                return { affected: 0 };
              }
              const targetId = params?.id;
              const target = models.get(targetId);
              if (!target) return { affected: 0 };
              target.isDefault = true;
              return { affected: 1 };
            }),
          })),
        };
      }),
    };

    const ds = { transaction: async (cb: any) => { transactionCalls.push('txStart'); const r = await cb(em); transactionCalls.push('txEnd'); return r; } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AppConfigService,
        { provide: getRepositoryToken(AppConfig), useValue: {
          findOne: jest.fn(async ({ where }: any) => appConfigs.get(where.id) ?? null),
        } },
        { provide: getRepositoryToken(Model), useValue: modelRepo },
        { provide: DataSource, useValue: ds },
      ],
    }).compile();

    svc = moduleRef.get(AppConfigService);
  });

  function seedModel(
    id: string,
    enabled = true,
    isDefault = false,
    visibility: 'public' | 'private' = 'public',
  ) {
    models.set(id, { id, enabled, isDefault, visibility });
  }

  describe('read()', () => {
    it('returns defaultModelId:null when nothing is configured', async () => {
      const r = await svc.read();
      expect(r).toEqual({ defaultModelId: null });
    });
  });

  describe('update()', () => {
    it('clears the default when given null', async () => {
      seedModel('m1', true, true);
      appConfigs.set('singleton', { id: 'singleton', defaultModelId: 'm1' });

      const r = await svc.update({ defaultModelId: null });
      expect(r).toEqual({ defaultModelId: null });
      expect(models.get('m1')!.isDefault).toBe(false);
      expect(appConfigs.get('singleton')!.defaultModelId).toBe(null);
    });

    it('replaces the existing default with a new one', async () => {
      seedModel('m1', true, true);
      seedModel('m2', true, false);
      appConfigs.set('singleton', { id: 'singleton', defaultModelId: 'm1' });

      const r = await svc.update({ defaultModelId: 'm2' });
      expect(r).toEqual({ defaultModelId: 'm2' });
      expect(models.get('m1')!.isDefault).toBe(false);
      expect(models.get('m2')!.isDefault).toBe(true);
      expect(appConfigs.get('singleton')!.defaultModelId).toBe('m2');
    });

    it('sets a default on a fresh database', async () => {
      seedModel('m1', true, false);

      const r = await svc.update({ defaultModelId: 'm1' });
      expect(r).toEqual({ defaultModelId: 'm1' });
      expect(models.get('m1')!.isDefault).toBe(true);
      expect(appConfigs.get('singleton')!.defaultModelId).toBe('m1');
    });

    it('rejects with 422 when the referenced model does not exist', async () => {
      await expect(svc.update({ defaultModelId: 'no-such-uuid' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rejects with 422 when the referenced model is disabled', async () => {
      seedModel('m1', false, false);
      await expect(svc.update({ defaultModelId: 'm1' })).rejects.toMatchObject({
        response: { code: 'model_not_eligible_default' },
      });
    });

    it('rejects with 422 when the referenced model is not public', async () => {
      seedModel('priv-1', true, false, 'private');

      const err = await svc.update({ defaultModelId: 'priv-1' }).catch((e) => e);

      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect(err.getResponse()).toMatchObject({ code: 'model_not_eligible_default' });
      expect(err.getResponse().message).toMatch(/public/i);
    });

    it('accepts a public enabled model as the default', async () => {
      seedModel('pub-1', true, false, 'public');

      const r = await svc.update({ defaultModelId: 'pub-1' });

      expect(r).toEqual({ defaultModelId: 'pub-1' });
    });

    it('runs clear → set → findOne → save inside a single transaction', async () => {
      seedModel('m1', true, false);
      await svc.update({ defaultModelId: 'm1' });
      expect(transactionCalls[0]).toBe('txStart');
      expect(transactionCalls[transactionCalls.length - 1]).toBe('txEnd');
      expect(transactionCalls).toContain('clearExecute');
      expect(transactionCalls).toContain('setExecute');
      expect(transactionCalls).toContain('save');
    });
  });
});
