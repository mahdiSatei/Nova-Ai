import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(User)
    private readonly repo: Repository<User>,
  ) {}

  /**
   * Create a new user with role 'user'. The email is stored
   * lowercased; uniqueness is enforced at the DB level by the
   * case-insensitive index on `email`. Passwords are hashed with
   * Argon2id; bcrypt is a fallback when Argon2's native binary is
   * unavailable (e.g. some Windows dev boxes without a C++ toolchain).
   */
  async create(input: { email: string; password: string }): Promise<User> {
    const email = input.email.toLowerCase();
    const passwordHash = await this.hashPassword(input.password);
    try {
      const user = this.repo.create({
        email,
        passwordHash,
        role: 'user',
      });
      return await this.repo.save(user);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
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

  async findById(id: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    return user;
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
}
