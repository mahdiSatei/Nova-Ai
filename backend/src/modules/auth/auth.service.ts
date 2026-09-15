import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '../../config/configuration';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from '../users/entities/user.entity';
import { UsersService } from '../users/users.service';
import { revokeJti } from './strategies/revocation-list';
import { AuthResponseDto } from './dto/auth-response.dto';

interface JwtClaims {
  sub: string;
  email: string;
  role: 'user' | 'admin';
  jti: string;
  iat: number;
  exp: number;
}

interface RefreshClaims {
  sub: string;
  type: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

/**
 * Token issuance, refresh rotation, and logout. The same login endpoint
 * issues tokens for both regular users and admin accounts — admin role
 * is determined by the User row, not the request.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  async register(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.users.create({ email, password });
    return this.issueTokens(user);
  }

  /**
   * Authenticate (resolve the user + verify password + mark lastLoginAt).
   * Returns the User row on success. On ANY failure (unknown email OR wrong
   * password) throws generic UnauthorizedException so callers cannot
   * distinguish the two — no email enumeration, no role enumeration.
   */
  private async authenticate(email: string, password: string): Promise<User> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      // Constant-time-ish no-op so attackers can't time-distinguish.
      await this.dummyCompare(password);
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'The provided credentials were invalid.',
      });
    }
    const ok = await this.verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'The provided credentials were invalid.',
      });
    }
    await this.users.markLoggedIn(user.id);
    return user;
  }

  /**
   * Login: returns a generic 401 for any failure (wrong password,
   * unknown email, disabled account) so email enumeration is
   * impossible.
   */
  async login(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.authenticate(email, password);
    return this.issueTokens(user);
  }

  /**
   * Admin login: same flow as login(), plus a strict role check. Any
   * non-admin account (regardless of password validity) receives the
   * same generic 401 as a bad password — no role enumeration.
   */
  async loginAsAdmin(email: string, password: string): Promise<AuthResponseDto> {
    const user = await this.authenticate(email, password);
    if (user.role !== 'admin') {
      throw new UnauthorizedException({
        code: 'invalid_credentials',
        message: 'The provided credentials were invalid.',
      });
    }
    return this.issueTokens(user);
  }

  /**
   * Refresh: validates the refresh JWT, rotates (revokes old jti +
   * issues a new pair), persists the new refresh record. Old jti is
   * added to the in-memory revocation list and the DB row is marked
   * revoked.
   */
  async refresh(refreshTokenJwt: string): Promise<AuthResponseDto> {
    let claims: RefreshClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshClaims>(refreshTokenJwt, {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'The refresh token is invalid or expired.',
      });
    }
    if (claims.type !== 'refresh') {
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'The refresh token is invalid.',
      });
    }

    // Verify the refresh row exists and isn't revoked/expired.
    const stored = await this.refreshRepo.findOne({ where: { jti: claims.jti } });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'invalid_token',
        message: 'The refresh token is invalid or expired.',
      });
    }

    // Mark the old refresh revoked and put jti on the in-memory
    // revocation list so the access token derived from the same login
    // also fails subsequent calls (matching the user-facing "logout"
    // semantics).
    stored.revokedAt = new Date();
    await this.refreshRepo.save(stored);
    revokeJti(stored.jti, stored.expiresAt);

    const user = await this.users.findById(claims.sub);
    return this.issueTokens(user);
  }

  /**
   * Logout: writes the caller's access-token jti to the in-memory
   * revocation list (until natural expiry). Returns true on success.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async logout(accessJti: string, accessExpiresAt: Date): Promise<void> {
    revokeJti(accessJti, accessExpiresAt);
  }

  // ────────────────────────── private helpers ──────────────────────────

  private async issueTokens(user: User): Promise<AuthResponseDto> {
    const accessJti = this.randomJti();
    const refreshJti = this.randomJti();

    const accessTtl = this.config.get('jwt.accessTtl', { infer: true });
    const refreshTtl = this.config.get('jwt.refreshTtl', { infer: true });

    const accessClaims: Omit<JwtClaims, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: accessJti,
    };
    const refreshClaims: Omit<RefreshClaims, 'iat' | 'exp'> = {
      sub: user.id,
      type: 'refresh',
      jti: refreshJti,
    };

    const accessToken = await this.jwt.signAsync(accessClaims, {
      expiresIn: accessTtl,
    });
    const refreshJwt = await this.jwt.signAsync(refreshClaims, {
      expiresIn: refreshTtl,
      secret: this.config.get('jwt.refreshSecret', { infer: true }),
    });

    // Persist the refresh token row for revocation tracking.
    const refreshExpiresAt = this.addDuration(new Date(), refreshTtl);
    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId: user.id,
        jti: refreshJti,
        expiresAt: refreshExpiresAt,
        revokedAt: null,
      }),
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt.toISOString(),
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      },
      accessToken,
      refreshToken: refreshJwt,
      expiresIn: this.toSeconds(accessTtl),
    };
  }

  private async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      const argon2 = await import('argon2');
      return await argon2.verify(hash, password);
    } catch {
      const bcrypt = await import('bcrypt');
      return bcrypt.compare(password, hash);
    }
  }

  /**
   * Constant-time dummy compare so timing differences between
   * "user not found" and "user found, wrong password" are minimized.
   */
  private async dummyCompare(password: string): Promise<void> {
    try {
      const bcrypt = await import('bcrypt');
      await bcrypt.compare(password, '$2b$12$dummyhashplaceholderfortimingattackprotection....');
    } catch {
      /* ignore */
    }
  }

  private randomJti(): string {
    // 128 bits of entropy, hex-encoded.
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private toSeconds(duration: string): number {
    const m = /^(\d+)([smhd])$/.exec(duration);
    if (!m) return 900;
    const n = Number(m[1]);
    switch (m[2]) {
      case 's': return n;
      case 'm': return n * 60;
      case 'h': return n * 3600;
      case 'd': return n * 86400;
      default: return 900;
    }
  }

  private addDuration(from: Date, duration: string): Date {
    const m = /^(\d+)([smhd])$/.exec(duration);
    if (!m) return new Date(from.getTime() + 15 * 60_000);
    const n = Number(m[1]);
    const ms =
      m[2] === 's' ? n * 1000 :
      m[2] === 'm' ? n * 60_000 :
      m[2] === 'h' ? n * 3_600_000 :
      n * 86_400_000;
    return new Date(from.getTime() + ms);
  }
}


