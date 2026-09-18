import { Test } from '@nestjs/testing';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModelAccessService, AccessViewer } from '../../src/modules/models/model-access.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('ModelAccessService', () => {
  let svc: ModelAccessService;
  let userRepo: { findOne: jest.Mock };

  const viewer = (role: 'user' | 'admin', accessTier: 'free' | 'commercial'): AccessViewer => ({
    role,
    accessTier,
  });

  const userRow = (role: 'user' | 'admin', accessTier: 'free' | 'commercial') => ({
    id: 'u-1',
    role,
    accessTier,
  });

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [ModelAccessService, { provide: getRepositoryToken(User), useValue: userRepo }],
    }).compile();
    svc = moduleRef.get(ModelAccessService);
  });

  describe('canAccess', () => {
    it.each([
      ['free', 'user', 'public', true],
      ['free', 'user', 'commercial', false],
      ['free', 'user', 'private', false],
      ['commercial', 'user', 'public', true],
      ['commercial', 'user', 'commercial', true],
      ['commercial', 'user', 'private', false],
      ['free', 'admin', 'public', true],
      ['free', 'admin', 'commercial', true],
      ['free', 'admin', 'private', true],
    ] as const)('tier=%s role=%s visibility=%s => %s', (accessTier, role, visibility, expected) => {
      expect(svc.canAccess(viewer(role, accessTier), { visibility, enabled: true })).toBe(expected);
    });

    it('denies everything to an unknown viewer', () => {
      expect(svc.canAccess(null, { visibility: 'public', enabled: true })).toBe(false);
      expect(svc.canAccess(undefined, { visibility: 'public', enabled: true })).toBe(false);
    });

    it('denies a disabled model even to an admin', () => {
      expect(
        svc.canAccess(viewer('admin', 'commercial'), { visibility: 'public', enabled: false }),
      ).toBe(false);
    });
  });

  describe('loadViewer', () => {
    it('loads only the fields needed by the policy', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'commercial'));
      const result = await svc.loadViewer('u-1');
      expect(result).toEqual({ role: 'user', accessTier: 'commercial' });
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        select: ['id', 'role', 'accessTier'],
      });
    });

    it('returns null for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      expect(await svc.loadViewer('missing')).toBeNull();
    });
  });

  describe('canAccessUser', () => {
    it('grants a commercial model to a commercial user', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'commercial'));
      expect(await svc.canAccessUser('u-1', { visibility: 'commercial', enabled: true })).toBe(
        true,
      );
    });

    it('denies a commercial model to a free user', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      expect(await svc.canAccessUser('u-1', { visibility: 'commercial', enabled: true })).toBe(
        false,
      );
    });
  });

  describe('filterAccessible', () => {
    it('keeps only entitled models and loads the viewer once', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      const models = [
        { id: 'pub', visibility: 'public' as const, enabled: true },
        { id: 'com', visibility: 'commercial' as const, enabled: true },
        { id: 'priv', visibility: 'private' as const, enabled: true },
        { id: 'off', visibility: 'public' as const, enabled: false },
      ];
      const result = await svc.filterAccessible('u-1', models);
      expect(result.map((m) => m.id)).toEqual(['pub']);
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('assertCanUseModel', () => {
    it('throws model_unavailable for a disabled model', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      await expect(
        svc.assertCanUseModel('u-1', { visibility: 'public', enabled: false }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('throws model_forbidden with a stable code for an unentitled viewer', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      const err = await svc
        .assertCanUseModel('u-1', { visibility: 'commercial', enabled: true })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('resolves for a public model', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user', 'free'));
      await expect(
        svc.assertCanUseModel('u-1', { visibility: 'public', enabled: true }),
      ).resolves.toBeUndefined();
    });
  });
});
