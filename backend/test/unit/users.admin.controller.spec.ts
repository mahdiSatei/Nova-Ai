import { Test } from '@nestjs/testing';
import { UsersAdminController } from '../../src/modules/users/users.admin.controller';
import { UsersService } from '../../src/modules/users/users.service';
import type { User } from '../../src/modules/users/entities/user.entity';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let users: {
    listForAdmin: jest.Mock;
  };

  const sampleUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      displayName: null,
      avatarSeed: null,
      passwordHash: 'super-secret-hash',
      role: 'user',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastLoginAt: new Date('2026-02-01T00:00:00Z'),
      lastSelectedModelId: null,
      refreshTokens: [],
      conversations: [],
      ...overrides,
    }) as User;

  beforeEach(async () => {
    users = {
      listForAdmin: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [{ provide: UsersService, useValue: users }],
    }).compile();

    controller = moduleRef.get(UsersAdminController);
  });

  it('lists users without leaking sensitive or retired fields and defaults pagination', async () => {
    const user = sampleUser();

    // Simulate a legacy object containing the retired field. The controller
    // must not expose it even if such a property happens to exist at runtime.
    Object.assign(user, { accessTier: 'free' });

    users.listForAdmin.mockResolvedValue({
      items: [user],
      total: 1,
    });

    const result = await controller.list(undefined, undefined, undefined);

    expect(users.listForAdmin).toHaveBeenCalledWith({
      query: undefined,
      limit: 20,
      offset: 0,
    });

    expect(result).toEqual({
      items: [
        {
          id: 'u-1',
          email: 'a@example.com',
          username: 'john_doe',
          displayName: null,
          avatarSeed: null,
          role: 'user',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastLoginAt: '2026-02-01T00:00:00.000Z',
        },
      ],
      total: 1,
    });

    expect(result.items[0]).not.toHaveProperty('passwordHash');
    expect(result.items[0]).not.toHaveProperty('accessTier');
  });

  it('clamps limit to 100 and forwards the search term and offset', async () => {
    users.listForAdmin.mockResolvedValue({
      items: [],
      total: 0,
    });

    const result = await controller.list('ali', '500', '5');

    expect(users.listForAdmin).toHaveBeenCalledWith({
      query: 'ali',
      limit: 100,
      offset: 5,
    });

    expect(result).toEqual({
      items: [],
      total: 0,
    });
  });

  it('uses default pagination for non-positive values', async () => {
    users.listForAdmin.mockResolvedValue({
      items: [],
      total: 0,
    });

    await controller.list('john', '0', '-10');

    expect(users.listForAdmin).toHaveBeenCalledWith({
      query: 'john',
      limit: 20,
      offset: 0,
    });
  });

  it('maps a user with a null lastLoginAt correctly', async () => {
    users.listForAdmin.mockResolvedValue({
      items: [sampleUser({ lastLoginAt: undefined })],
      total: 1,
    });

    const result = await controller.list();

    expect(result.items[0]).toEqual({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      displayName: null,
      avatarSeed: null,
      role: 'user',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastLoginAt: null,
    });
  });
});
