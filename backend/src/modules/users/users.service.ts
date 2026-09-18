import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { USER_ACCESS_TIERS, UserAccessTier } from '../models/model-visibility';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  /**
   * Create a new user with role 'user'. Email and username are stored
   * lowercased; uniqueness is enforced at the DB level by the
   * case-insensitive indexes on `email` and `username`. Passwords are
   * hashed with Argon2id; bcrypt is a fallback when Argon2's native
   * binary is unavailable (e.g. some Windows dev boxes without a C++
   * toolchain). Username is optional (null) for legacy accounts.
   */
  async create(input: {
    username?: string | null;
    email: string;
    password: string;
  }): Promise<User> {
    const email = input.email.toLowerCase();
    const username = input.username ? input.username.toLowerCase() : null;
    const passwordHash = await this.hashPassword(input.password);
    try {
      const user = this.repo.create({
        username,
        email,
        passwordHash,
        role: 'user',
      });
      return await this.repo.save(user);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        if (this.isUsernameViolation(err)) {
          throw new ConflictException({
            code: 'username_taken',
            message: 'That username is already taken.',
          });
        }
        throw new ConflictException({
          code: 'email_taken',
          message: 'That email is already registered.',
        });
      }
      throw err;
    }
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase() } });
  }

  /**
   * Resolve a login identifier: a value containing '@' is treated as
   * an email, anything else as a username. Both lookups are
   * case-insensitive (values are lowercased here, matching storage).
   */
  async findByIdentifier(identifier: string): Promise<User | null> {
    const value = identifier.trim().toLowerCase();
    return this.repo.findOne({ where: [{ email: value }, { username: value }] });
  }

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    return user;
  }

  /**
   * Apply a partial profile patch (display name and/or avatar seed).
   * Only provided keys change; returns the updated user; throws
   * NotFoundException for an unknown id. The caller (controller)
   * normalizes displayName input: trimmed, whitespace-only becomes
   * null.
   */
  async updateProfile(
    id: string,
    patch: { displayName?: string | null; avatarSeed?: string },
  ): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    if (patch.displayName !== undefined) user.displayName = patch.displayName;
    if (patch.avatarSeed !== undefined) user.avatarSeed = patch.avatarSeed;
    return this.repo.save(user);
  }

  /**
   * Set or clear the caller's last-selected model. Passing null clears
   * the sticky preference; a string id sets it after the controller has
   * already validated that the model exists and is enabled.
   */
  async setModelPreference(id: string, modelId: string | null): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    user.lastSelectedModelId = modelId;
    return this.repo.save(user);
  }

  /**
   * Admin: paginated user list with an optional case-insensitive substring
   * match on email or username. Returns the rows plus the unpaginated total so
   * the admin UI can show "n of m". Ordering is by email for stability.
   */
  async listForAdmin(params: {
    query?: string;
    limit: number;
    offset: number;
  }): Promise<{ items: User[]; total: number }> {
    const qb = this.repo
      .createQueryBuilder('u')
      .orderBy('u.email', 'ASC')
      .skip(params.offset)
      .take(params.limit);

    const term = params.query?.trim();
    if (term) {
      qb.where('LOWER(u.email) LIKE :term OR LOWER(u.username) LIKE :term', {
        term: `%${term.toLowerCase()}%`,
      });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  /**
   * Admin: set a user's entitlement tier. Throws 404 `user_not_found` for an
   * unknown id so the admin UI can distinguish "gone" from "invalid input".
   */
  async setAccessTier(id: string, accessTier: UserAccessTier): Promise<User> {
    if (!USER_ACCESS_TIERS.includes(accessTier)) {
      throw new UnprocessableEntityException({
        code: 'validation_failed',
        message: 'accessTier must be one of free, commercial.',
      });
    }
    const user = await this.repo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException({ code: 'user_not_found', message: 'User not found.' });
    }
    user.accessTier = accessTier;
    return this.repo.save(user);
  }

  /** Update lastLoginAt to now. Silent on failure — best-effort. */
  async markLoggedIn(id: string): Promise<void> {
    try {
      await this.repo.update({ id }, { lastLoginAt: new Date() });
    } catch (err) {
      this.logger.warn(`markLoggedIn failed for ${id}: ${(err as Error).message}`);
    }
  }

  private async hashPassword(password: string): Promise<string> {
    try {
      const argon2 = await import('argon2');
      return await argon2.hash(password, { type: argon2.argon2id });
    } catch {
      const bcrypt = await import('bcrypt');
      return bcrypt.hash(password, 12);
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    // TypeORM / SQLite surfaces unique violations with code SQLITE_CONSTRAINT_UNIQUE
    // or a message containing "UNIQUE constraint failed"; PostgreSQL uses code 23505.
    const anyErr = err as { code?: string; message?: string; driverError?: { code?: string } };
    const code = anyErr?.code ?? anyErr?.driverError?.code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === '23505') return true;
    return typeof anyErr?.message === 'string' && /UNIQUE constraint failed/i.test(anyErr.message);
  }

  /**
   * Distinguish which unique index fired: prefer the constraint name
   * (PostgreSQL surfaces it on the driver error), fall back to the
   * SQLite message which names the offending column.
   */
  private isUsernameViolation(err: unknown): boolean {
    const anyErr = err as {
      constraint?: string;
      message?: string;
      driverError?: { constraint?: string };
    };
    const constraint = anyErr?.constraint ?? anyErr?.driverError?.constraint;
    if (typeof constraint === 'string') return /username/i.test(constraint);
    return typeof anyErr?.message === 'string' && /username/i.test(anyErr.message);
  }
}
