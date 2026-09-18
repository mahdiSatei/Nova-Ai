import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersController } from '../../src/modules/users/users.controller';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';

describe('UsersController', () => {
  let controller: UsersController;
  let users: {
    findById: jest.Mock;
    updateProfile: jest.Mock;
    setModelPreference: jest.Mock;
  };
  let models: {
    findById: jest.Mock;
  };
  let access: {
    assertCanUseModel: jest.Mock;
  };

  const sampleUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      displayName: null,
      avatarSeed: null,
      passwordHash: 'h',
      role: 'user',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastLoginAt: new Date('2026-02-01T00:00:00Z'),
      lastSelectedModelId: null,
      refreshTokens: [],
      conversations: [],
      ...overrides,
    } as User);

  beforeEach(async () => {
    users = {
      findById: jest.fn(),
      updateProfile: jest.fn(),
      setModelPreference: jest.fn(),
    };
    models = {
      findById: jest.fn(),
    };
    access = { assertCanUseModel: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: users },
        { provide: ModelsService, useValue: models },
        { provide: ModelAccessService, useValue: access },
      ],
    }).compile();

    controller = moduleRef.get(UsersController);
  });

  describe('me', () => {
    it('returns the caller profile without password fields', async () => {
      users.findById.mockResolvedValue(sampleUser());
      const result = await controller.me({ id: 'u-1' } as never);
      expect(users.findById).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({
        id: 'u-1',
        email: 'a@example.com',
        username: 'john_doe',
        displayName: null,
        avatarSeed: null,
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-02-01T00:00:00.000Z',
      });
      expect(JSON.stringify(result)).not.toContain('password');
    });
  });

  describe('updateMe', () => {
    it('trims displayName and returns the updated profile', async () => {
      users.updateProfile.mockResolvedValue(sampleUser({ displayName: 'Jane' }));
      const result = await controller.updateMe({ id: 'u-1' } as never, {
        displayName: '  Jane  ',
      });
      expect(users.updateProfile).toHaveBeenCalledWith('u-1', { displayName: 'Jane' });
      expect(result.displayName).toBe('Jane');
    });

    it('converts a whitespace-only displayName to null (clear)', async () => {
      users.updateProfile.mockResolvedValue(sampleUser({ displayName: null }));
      const result = await controller.updateMe({ id: 'u-1' } as never, { displayName: '   ' });
      expect(users.updateProfile).toHaveBeenCalledWith('u-1', { displayName: null });
      expect(result.displayName).toBeNull();
    });

    it('passes avatarSeed through without touching displayName', async () => {
      users.updateProfile.mockResolvedValue(
        sampleUser({ avatarSeed: 'abc-123', displayName: 'Kept' }),
      );
      const result = await controller.updateMe({ id: 'u-1' } as never, {
        avatarSeed: 'abc-123',
      });
      expect(users.updateProfile).toHaveBeenCalledWith('u-1', { avatarSeed: 'abc-123' });
      expect(result.avatarSeed).toBe('abc-123');
      expect(result.displayName).toBe('Kept');
    });

    it('accepts both fields in one PATCH', async () => {
      users.updateProfile.mockResolvedValue(
        sampleUser({ displayName: 'Both', avatarSeed: 's' }),
      );
      await controller.updateMe({ id: 'u-1' } as never, {
        displayName: ' Both ',
        avatarSeed: 's',
      });
      expect(users.updateProfile).toHaveBeenCalledWith('u-1', {
        displayName: 'Both',
        avatarSeed: 's',
      });
    });

    it('rejects an empty patch with 400', async () => {
      await expect(controller.updateMe({ id: 'u-1' } as never, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(users.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('setModelPreference', () => {
    const enabledModel = { id: 'model-enabled', enabled: true, displayName: 'GPT-4' };
    const disabledModel = { id: 'model-disabled', enabled: false, displayName: 'GPT-3' };

    it('sets the preference when the model is enabled', async () => {
      models.findById.mockResolvedValue(enabledModel);
      users.setModelPreference.mockResolvedValue(sampleUser());

      const result = await controller.setModelPreference({ id: 'u-1' } as never, {
        modelId: enabledModel.id,
      });

      expect(models.findById).toHaveBeenCalledWith(enabledModel.id);
      expect(users.setModelPreference).toHaveBeenCalledWith('u-1', enabledModel.id);
      expect(result.modelId).toBe(enabledModel.id);
    });

    it('throws 422 when the model is disabled (delegated to the policy service)', async () => {
      models.findById.mockResolvedValue(disabledModel);
      access.assertCanUseModel.mockRejectedValue(
        new UnprocessableEntityException({
          code: 'model_unavailable',
          message: 'The selected model is not available.',
        }),
      );

      const err = await controller
        .setModelPreference({ id: 'u-1' } as never, { modelId: disabledModel.id })
        .catch((e) => e);

      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({ code: 'model_unavailable' });
      expect(users.setModelPreference).not.toHaveBeenCalled();
    });

    it('clears the preference when modelId is null', async () => {
      users.setModelPreference.mockResolvedValue(sampleUser());

      const result = await controller.setModelPreference({ id: 'u-1' } as never, {
        modelId: null,
      });

      expect(models.findById).not.toHaveBeenCalled();
      expect(users.setModelPreference).toHaveBeenCalledWith('u-1', null);
      expect(result.modelId).toBeNull();
    });

    it('clears the preference when modelId is omitted', async () => {
      users.setModelPreference.mockResolvedValue(sampleUser());

      const result = await controller.setModelPreference({ id: 'u-1' } as never, {});

      expect(models.findById).not.toHaveBeenCalled();
      expect(users.setModelPreference).toHaveBeenCalledWith('u-1', null);
      expect(result.modelId).toBeNull();
    });

    it('denies an unentitled but enabled model with model_forbidden', async () => {
      models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });
      access.assertCanUseModel.mockRejectedValue(
        new ForbiddenException({ code: 'model_forbidden', message: 'no' }),
      );

      const err = await controller
        .setModelPreference({ id: 'u-1' } as never, { modelId: 'com' })
        .catch((e) => e);

      expect(err.getStatus()).toBe(403);
      expect(err.getResponse()).toMatchObject({ code: 'model_forbidden' });
      expect(users.setModelPreference).not.toHaveBeenCalled();
    });

    it('maps an unknown model id to 422 model_unavailable', async () => {
      models.findById.mockRejectedValue(
        new NotFoundException({ code: 'model_not_found', message: 'x' }),
      );

      const err = await controller
        .setModelPreference({ id: 'u-1' } as never, { modelId: 'nope' })
        .catch((e) => e);

      expect(err.getStatus()).toBe(422);
      expect(err.getResponse()).toMatchObject({ code: 'model_unavailable' });
    });
  });
});
