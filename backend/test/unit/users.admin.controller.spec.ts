import { Test } from '@nestjs/testing';
import { UsersAdminController } from '../../src/modules/users/users.admin.controller';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let users: {
    findAll: jest.Mock;
  };

  const sampleUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      displayName: null,
      avatarSeed: null,
      passwordHash: 'secret-hash',
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
      findAll: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [{ provide: UsersService, useValue: users }],
    }).compile();

    controller = moduleRef.get(UsersAdminController);
  });

  describe('findAll', () => {
    it('returns users mapped to the safe admin shape (no password fields)', async () => {
      users.findAll.mockResolvedValue([
        sampleUser(),
        sampleUser({ id: 'u-2', email: 'b@example.com', role: 'admin' }),
      ]);

      const result = await controller.findAll(undefined, undefined);

      expect(users.findAll).toHaveBeenCalledWith(20, 0);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'u-1',
        email: 'a@example.com',
        username: 'john_doe',
        displayName: null,
        avatarSeed: null,
        role: 'user',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-02-01T00:00:00.000Z',
      });
      expect(result[1].role).toBe('admin');
      expect(JSON.stringify(result)).not.toContain('password');
      expect(JSON.stringify(result)).not.toContain('secret-hash');
    });

    it('parses and caps limit to 100', async () => {
      users.findAll.mockResolvedValue([]);
      await controller.findAll('500', '10');
      expect(users.findAll).toHaveBeenCalledWith(100, 10);
    });

    it('defaults to 20/0 when query params are absent', async () => {
      users.findAll.mockResolvedValue([]);
      await controller.findAll(undefined, undefined);
      expect(users.findAll).toHaveBeenCalledWith(20, 0);
    });

    it('serializes a null lastLoginAt as null', async () => {
      users.findAll.mockResolvedValue([sampleUser({ lastLoginAt: undefined })]);
      const result = await controller.findAll(undefined, undefined);
      expect(result[0].lastLoginAt).toBeNull();
    });
  });
});
