import { Test } from '@nestjs/testing';
import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ModelAccessService, AccessViewer } from '../../src/modules/models/model-access.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('ModelAccessService', () => {
  let svc: ModelAccessService;
  let userRepo: { findOne: jest.Mock };

  const viewer = (role: 'user' | 'admin'): AccessViewer => ({ role });

  const userRow = (role: 'user' | 'admin') => ({ id: 'u-1', role });

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [ModelAccessService, { provide: getRepositoryToken(User), useValue: userRepo }],
    }).compile();
    svc = moduleRef.get(ModelAccessService);
  });

  describe('canAccess', () => {
    it.each([
      ['user', 'public', true, true],
      ['user', 'private', true, false],
      ['admin', 'public', true, true],
      ['admin', 'private', true, true],
      ['user', 'public', false, false],
      ['admin', 'private', false, false],
    ] as const)(
      'role=%s visibility=%s enabled=%s => %s',
      (role, visibility, enabled, expected) => {
        expect(svc.canAccess(viewer(role), { visibility, enabled })).toBe(expected);
      },
    );

    it('denies everything to an unknown viewer', () => {
      expect(svc.canAccess(null, { visibility: 'public', enabled: true })).toBe(false);
      expect(svc.canAccess(undefined, { visibility: 'public', enabled: true })).toBe(false);
    });

    it('denies a disabled model even to an admin', () => {
      expect(svc.canAccess(viewer('admin'), { visibility: 'public', enabled: false })).toBe(false);
    });
  });

  describe('loadViewer', () => {
    it('loads only the fields needed by the policy', async () => {
      userRepo.findOne.mockResolvedValue(userRow('admin'));
      const result = await svc.loadViewer('u-1');
      expect(result).toEqual({ role: 'admin' });
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        select: ['id', 'role'],
      });
    });

    it('returns null for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      expect(await svc.loadViewer('missing')).toBeNull();
    });
  });

  describe('canAccessUser', () => {
    it('grants a public model to a regular user', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user'));
      expect(await svc.canAccessUser('u-1', { visibility: 'public', enabled: true })).toBe(true);
    });

    it('denies a private model to a regular user', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user'));
      expect(await svc.canAccessUser('u-1', { visibility: 'private', enabled: true })).toBe(false);
    });
  });

  describe('filterAccessible', () => {
    it('keeps only enabled public models for a regular user and loads the viewer once', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user'));
      const models = [
        { id: 'pub', visibility: 'public' as const, enabled: true },
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
      userRepo.findOne.mockResolvedValue(userRow('user'));
      await expect(
        svc.assertCanUseModel('u-1', { visibility: 'public', enabled: false }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('throws model_forbidden with a stable code for a private model as a non-admin', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user'));
      const err = await svc
        .assertCanUseModel('u-1', { visibility: 'private', enabled: true })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
      expect(userRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it('resolves for a public model', async () => {
      userRepo.findOne.mockResolvedValue(userRow('user'));
      await expect(
        svc.assertCanUseModel('u-1', { visibility: 'public', enabled: true }),
      ).resolves.toBeUndefined();
    });
  });
});
