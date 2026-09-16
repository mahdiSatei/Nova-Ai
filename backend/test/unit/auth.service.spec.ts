import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../../src/modules/auth/auth.service';
import { UsersService } from '../../src/modules/users/users.service';
import { RefreshToken } from '../../src/modules/auth/entities/refresh-token.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { _resetForTests, isRevoked } from '../../src/modules/auth/strategies/revocation-list';

describe('AuthService', () => {
  let svc: AuthService;
  let users: {
    create: jest.Mock;
    findByEmail: jest.Mock;
    findById: jest.Mock;
    markLoggedIn: jest.Mock;
  };
  let refreshRepo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };
  let jwt: { signAsync: jest.Mock; verifyAsync: jest.Mock };

  // Allow enough time for bcrypt-at-cost-12 fallback hashing during
  // service construction.
  jest.setTimeout(15_000);

  // Use bcrypt to hash the test password so verifyPassword() can
  // succeed against the mocked passwordHash. We force the bcrypt
  // fallback by deleting the argon2 module from require.cache before
  // the test runs (this is a one-time setup, not per-test).
  const TEST_PASSWORD = 'correct-horse-battery-staple';
  let TEST_HASH: string;

  const validUser = (overrides: Partial<User> = {}): User =>
    ({
      id: 'u-1',
      email: 'a@example.com',
      passwordHash: TEST_HASH,
      role: 'user',
      createdAt: new Date(),
      lastLoginAt: undefined,
      lastSelectedModelId: null,
      refreshTokens: [],
      conversations: [],
      ...overrides,
    } as User);

  beforeAll(() => {
    TEST_HASH = bcrypt.hashSync(TEST_PASSWORD, 4);
    // Make argon2 unavailable so the service falls back to bcrypt,
    // which produces deterministically verifiable hashes here.
    jest.mock('argon2', () => {
      throw new Error('argon2 disabled for tests');
    });
  });

  beforeEach(async () => {
    _resetForTests();
    users = {
      create: jest.fn(),
      findByEmail: jest.fn(),
      findById: jest.fn(),
      markLoggedIn: jest.fn(),
    };
    refreshRepo = {
      create: jest.fn((dto) => dto),
      save: jest.fn(async (row) => row),
      findOne: jest.fn(),
    };
    let counter = 0;
    jwt = {
      signAsync: jest.fn(async () => `signed-token-${++counter}`),
      verifyAsync: jest.fn(async (token: string) => {
        if (token === 'good-refresh') {
          return { sub: 'u-1', type: 'refresh', jti: 'r-jti-1', iat: 0, exp: Math.floor(Date.now() / 1000) + 3600 };
        }
        if (token === 'bad-refresh') {
          throw new Error('invalid signature');
        }
        return {};
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: {
          get: (k: string) => {
            const map: Record<string, unknown> = {
              'jwt.secret': 's',
              'jwt.refreshSecret': 'rs',
              'jwt.accessTtl': '15m',
              'jwt.refreshTtl': '7d',
            };
            return map[k];
          },
        } },
        { provide: getRepositoryToken(RefreshToken), useValue: refreshRepo },
      ],
    }).compile();

    svc = moduleRef.get(AuthService);
  });

  it('login returns 401 with a generic message for unknown email (no enumeration)', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(svc.login('nobody@example.com', 'whatever-12-chars')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('login returns 401 with the same generic message for wrong password', async () => {
    users.findByEmail.mockResolvedValue(validUser());
    await expect(svc.login('a@example.com', 'wrong-12-chars-or-more')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('login on valid credentials issues a token pair', async () => {
    users.findByEmail.mockResolvedValue(validUser());
    const r = await svc.login('a@example.com', 'correct-horse-battery-staple');
    expect(r.accessToken).toMatch(/^signed-token-/);
    expect(r.refreshToken).toMatch(/^signed-token-/);
    expect(users.markLoggedIn).toHaveBeenCalledWith('u-1');
  });

  it('loginAsAdmin throws UnauthorizedException for a non-admin account (even with valid password)', async () => {
    users.findByEmail.mockResolvedValue(validUser()); // role === 'user'
    await expect(
      svc.loginAsAdmin('a@example.com', 'correct-horse-battery-staple'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(jwt.signAsync).not.toHaveBeenCalled();
  });

  it('loginAsAdmin issues a token pair when the account is an admin', async () => {
    users.findByEmail.mockResolvedValue({ ...validUser(), role: 'admin' });
    const r = await svc.loginAsAdmin('admin@example.com', 'correct-horse-battery-staple');
    expect(r.accessToken).toMatch(/^signed-token-/);
    expect(r.refreshToken).toMatch(/^signed-token-/);
    expect(users.markLoggedIn).toHaveBeenCalledWith('u-1');
  });

  it('loginAsAdmin returns generic 401 for unknown email (no enumeration)', async () => {
    users.findByEmail.mockResolvedValue(null);
    await expect(
      svc.loginAsAdmin('nobody@example.com', 'whatever-12-chars'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh rotates: old jti is revoked, new pair issued', async () => {
    users.findById.mockResolvedValue(validUser());
    refreshRepo.findOne.mockResolvedValue({
      id: 'rt-1',
      userId: 'u-1',
      jti: 'r-jti-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });

    const r = await svc.refresh('good-refresh');
    expect(r.accessToken).toBeDefined();
    expect(r.refreshToken).toBeDefined();
    expect(refreshRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
    expect(isRevoked('r-jti-1')).toBe(true);
  });

  it('refresh rejects an invalid refresh token', async () => {
    await expect(svc.refresh('bad-refresh')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh rejects an already-revoked refresh token', async () => {
    refreshRepo.findOne.mockResolvedValue({
      id: 'rt-2',
      userId: 'u-1',
      jti: 'r-jti-2',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(),
    });
    await expect(svc.refresh('good-refresh')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
