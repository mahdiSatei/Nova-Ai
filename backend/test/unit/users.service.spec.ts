import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('UsersService', () => {
  let svc: UsersService;
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    const stored: User[] = [];
    repo = {
      create: jest.fn((dto) => ({ ...dto, id: 'u-1' } as User)),
      save: jest.fn(async (u: User) => {
        if (stored.find((x) => x.email === u.email)) {
          const err = new Error('UNIQUE constraint failed') as Error & { code: string };
          err.code = 'SQLITE_CONSTRAINT_UNIQUE';
          throw err;
        }
        stored.push(u);
        return u;
      }),
      findOne: jest.fn(async ({ where }: { where: { email: string } }) => {
        return stored.find((u) => u.email === where.email) ?? null;
      }),
      update: jest.fn(async () => undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    }).compile();

    svc = moduleRef.get(UsersService);
  });

  it('hashes the password (never stores plaintext) and lowercases email', async () => {
    const u = await svc.create({ email: 'Alice@Example.com', password: 'super-long-password-1' });
    expect(u.email).toBe('alice@example.com');
    expect(u.passwordHash).toBeDefined();
    expect(u.passwordHash).not.toBe('super-long-password-1');
    expect(u.passwordHash.length).toBeGreaterThan(40); // argon2 or bcrypt — both > 40 chars
  });

  it('rejects duplicate email with 409', async () => {
    await svc.create({ email: 'dup@example.com', password: 'super-long-password-1' });
    await expect(
      svc.create({ email: 'dup@example.com', password: 'super-long-password-2' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('finds by email case-insensitively', async () => {
    await svc.create({ email: 'Find@Example.com', password: 'super-long-password-1' });
    const found = await svc.findByEmail('find@example.com');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('find@example.com');
  });
});
