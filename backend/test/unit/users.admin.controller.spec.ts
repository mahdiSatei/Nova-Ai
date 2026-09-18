import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UsersAdminController } from '../../src/modules/users/users.admin.controller';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('UsersAdminController', () => {
  let controller: UsersAdminController;
  let users: { listForAdmin: jest.Mock; setAccessTier: jest.Mock };

  const sampleUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      passwordHash: 'super-secret-hash',
      role: 'user',
      accessTier: 'free',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as User;

  beforeEach(async () => {
    users = {
      listForAdmin: jest.fn(),
      setAccessTier: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersAdminController],
      providers: [{ provide: UsersService, useValue: users }],
    }).compile();
    controller = moduleRef.get(UsersAdminController);
  });

  it('lists users without leaking the password hash and defaults pagination', async () => {
    users.listForAdmin.mockResolvedValue({ items: [sampleUser()], total: 1 });

    const result = await controller.list(undefined, undefined, undefined);

    expect(users.listForAdmin).toHaveBeenCalledWith({ query: undefined, limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]).toEqual({
      id: 'u-1',
      email: 'a@example.com',
      username: 'john_doe',
      role: 'user',
      accessTier: 'free',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret-hash');
  });

  it('clamps limit to 100 and forwards the search term', async () => {
    users.listForAdmin.mockResolvedValue({ items: [], total: 0 });
    await controller.list('ali', '500', '5');
    expect(users.listForAdmin).toHaveBeenCalledWith({ query: 'ali', limit: 100, offset: 5 });
  });

  it('returns 404 user_not_found from the service', async () => {
    users.setAccessTier.mockRejectedValue(
      new NotFoundException({ code: 'user_not_found', message: 'User not found.' }),
    );

    const err = await controller
      .setAccessTier('missing', { accessTier: 'commercial' })
      .catch((e) => e);

    expect(err.getStatus()).toBe(404);
    expect(err.getResponse()).toMatchObject({ code: 'user_not_found' });
  });

  it('returns the updated tier', async () => {
    users.setAccessTier.mockResolvedValue(sampleUser({ accessTier: 'commercial' }));

    const result = await controller.setAccessTier('u-1', { accessTier: 'commercial' });

    expect(users.setAccessTier).toHaveBeenCalledWith('u-1', 'commercial');
    expect(result.accessTier).toBe('commercial');
  });
});
