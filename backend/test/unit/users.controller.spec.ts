import { Test } from '@nestjs/testing';
import { UsersController } from '../../src/modules/users/users.controller';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('UsersController', () => {
  let controller: UsersController;
  let users: {
    findById: jest.Mock;
    updateDisplayName: jest.Mock;
  };

  const sampleUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      displayName: null,
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
      updateDisplayName: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: users }],
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
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-02-01T00:00:00.000Z',
      });
      expect(JSON.stringify(result)).not.toContain('password');
    });
  });

  describe('updateMe', () => {
    it('trims displayName and returns the updated profile', async () => {
      users.updateDisplayName.mockResolvedValue(sampleUser({ displayName: 'Jane' }));
      const result = await controller.updateMe({ id: 'u-1' } as never, {
        displayName: '  Jane  ',
      });
      expect(users.updateDisplayName).toHaveBeenCalledWith('u-1', 'Jane');
      expect(result.displayName).toBe('Jane');
    });

    it('converts a whitespace-only displayName to null (clear)', async () => {
      users.updateDisplayName.mockResolvedValue(sampleUser({ displayName: null }));
      const result = await controller.updateMe({ id: 'u-1' } as never, { displayName: '   ' });
      expect(users.updateDisplayName).toHaveBeenCalledWith('u-1', null);
      expect(result.displayName).toBeNull();
    });
  });
});
