import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UsersService } from '../../src/modules/users/users.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('UsersService', () => {
  let svc: UsersService;
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    const stored: User[] = [];
    let idCounter = 0;
    const uniqueViolation = (constraint: string) => {
      const err = new Error('UNIQUE constraint failed') as Error & {
        code: string;
        driverError: { code: string; constraint: string };
      };
      err.code = 'SQLITE_CONSTRAINT_UNIQUE';
      err.driverError = { code: '23505', constraint };
      return err;
    };
    repo = {
      create: jest.fn((dto) => ({ ...dto, id: `u-${++idCounter}` } as User)),
      save: jest.fn(async (u: User) => {
        if (stored.find((x) => x.email === u.email && x.id !== u.id)) {
          throw uniqueViolation('uq_users_email_lower');
        }
        if (u.username && stored.find((x) => x.username === u.username && x.id !== u.id)) {
          throw uniqueViolation('uq_users_username_lower');
        }
        const existingIdx = stored.findIndex((x) => x.id === u.id);
        if (existingIdx >= 0) stored[existingIdx] = u;
        else stored.push(u);
        return u;
      }),
      findOne: jest.fn(
        async ({
          where,
        }: {
          where: { id?: string; email?: string; username?: string } | Array<{ id?: string; email?: string; username?: string }>;
        }) => {
          const clauses = Array.isArray(where) ? where : [where];
          return (
            stored.find((u) =>
              clauses.some(
                (w) =>
                  (w.email !== undefined && u.email === w.email) ||
                  (w.username !== undefined && u.username === w.username) ||
                  (w.id !== undefined && u.id === w.id),
              ),
            ) ?? null
          );
        },
      ),
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

  it('stores username lowercased alongside email', async () => {
    const u = await svc.create({
      username: 'John_Doe',
      email: 'Alice@Example.com',
      password: 'super-long-password-1',
    });
    expect(u.username).toBe('john_doe');
    expect(u.email).toBe('alice@example.com');
  });

  it('rejects duplicate email with 409 email_taken', async () => {
    await svc.create({ email: 'dup@example.com', password: 'super-long-password-1' });
    const err: ConflictException = await svc
      .create({ email: 'dup@example.com', password: 'super-long-password-2' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'email_taken' });
  });

  it('rejects duplicate username with 409 username_taken (case-insensitive)', async () => {
    await svc.create({
      username: 'taken_name',
      email: 'a@example.com',
      password: 'super-long-password-1',
    });
    const err: ConflictException = await svc
      .create({
        username: 'Taken_Name',
        email: 'b@example.com',
        password: 'super-long-password-1',
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'username_taken' });
  });

  it('finds by email case-insensitively', async () => {
    await svc.create({ email: 'Find@Example.com', password: 'super-long-password-1' });
    const found = await svc.findByEmail('find@example.com');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('find@example.com');
  });

  it('findByIdentifier resolves a user by email (with @)', async () => {
    await svc.create({
      username: 'john_doe',
      email: 'Find@Example.com',
      password: 'super-long-password-1',
    });
    const found = await svc.findByIdentifier('find@example.com');
    expect(found).not.toBeNull();
    expect(found!.username).toBe('john_doe');
  });

  it('findByIdentifier resolves a user by username (no @), case-insensitively', async () => {
    await svc.create({
      username: 'John_Doe',
      email: 'Find@Example.com',
      password: 'super-long-password-1',
    });
    const found = await svc.findByIdentifier('JOHN_doe');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('find@example.com');
  });

  it('findByIdentifier returns null for an unknown identifier', async () => {
    const found = await svc.findByIdentifier('nobody@example.com');
    expect(found).toBeNull();
  });

  it('updateDisplayName persists the given value and returns the updated user', async () => {
    await svc.create({
      username: 'john_doe',
      email: 'Find@Example.com',
      password: 'super-long-password-1',
    });
    const created = await svc.findByEmail('find@example.com');
    const updated = await svc.updateProfile(created!.id, { displayName: 'John Doe' });
    expect(updated.displayName).toBe('John Doe');
    const reloaded = await svc.findById(created!.id);
    expect(reloaded.displayName).toBe('John Doe');
  });

  it('updateDisplayName accepts null to clear the value', async () => {
    await svc.create({
      username: 'clear_me',
      email: 'clear@example.com',
      password: 'super-long-password-1',
    });
    const created = await svc.findByEmail('clear@example.com');
    const updated = await svc.updateProfile(created!.id, { displayName: null });
    expect(updated.displayName).toBeNull();
  });

  it('updateDisplayName throws NotFoundException for an unknown id', async () => {
    await expect(svc.updateProfile('no-such-id', { displayName: 'X' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('setModelPreference stores the given model id', async () => {
    const u = await svc.create({ email: 'setPref@example.com', password: 'super-long-password-1' });
    const updated = await svc.setModelPreference(u.id, 'model-123');
    expect(updated.lastSelectedModelId).toBe('model-123');
    const reloaded = await svc.findById(u.id);
    expect(reloaded.lastSelectedModelId).toBe('model-123');
  });

  it('setModelPreference accepts null to clear the value', async () => {
    const u = await svc.create({ email: 'clearPref@example.com', password: 'super-long-password-1' });
    await svc.setModelPreference(u.id, 'model-123');
    const cleared = await svc.setModelPreference(u.id, null);
    expect(cleared.lastSelectedModelId).toBeNull();
    const reloaded = await svc.findById(u.id);
    expect(reloaded.lastSelectedModelId).toBeNull();
  });

  it('setModelPreference throws NotFoundException for an unknown id', async () => {
    await expect(svc.setModelPreference('no-such-id', 'model-123')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updateProfile applies only the provided fields (partial patch)', async () => {
    const u = await svc.create({
      username: 'partial_me',
      email: 'partial@example.com',
      password: 'super-long-password-1',
    });
    u.displayName = 'Original';
    u.avatarSeed = 'seed-1';
    await svc.updateProfile(u.id, {}); // no-op patch
    const afterNoop = await svc.findById(u.id);
    expect(afterNoop.displayName).toBe('Original');
    expect(afterNoop.avatarSeed).toBe('seed-1');

    await svc.updateProfile(u.id, { avatarSeed: 'seed-2' });
    const afterSeed = await svc.findById(u.id);
    expect(afterSeed.avatarSeed).toBe('seed-2');
    expect(afterSeed.displayName).toBe('Original'); // untouched

    await svc.updateProfile(u.id, { displayName: 'New Name' });
    const afterName = await svc.findById(u.id);
    expect(afterName.displayName).toBe('New Name');
    expect(afterName.avatarSeed).toBe('seed-2'); // untouched
  });
});
