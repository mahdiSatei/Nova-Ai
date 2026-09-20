import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import { SetUserAccessTierDto } from './dto/set-access-tier.dto';
import type { User } from './entities/user.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Admin-only access-tier management (spec 003 §Scope — "Associate models with
 * the required role, subscription, or user group").
 *
 * Deliberately narrow: this surface assigns the entitlement tier that a model's
 * visibility is checked against. It is NOT account administration (no create,
 * disable, delete, or password reset) — that remains out of scope per spec 001.
 */

/** Admin listing shape (never includes password fields). */
interface AdminUserResponse {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  role: 'user' | 'admin';
  accessTier?: string;
  createdAt: string;
  lastLoginAt: string | null;
}

/**
 * Admin-only user management endpoints. Mirrors the other
 * `/v1/admin/*` controllers: JWT + RolesGuard with the `admin` role.
 */
@Controller('v1/admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersAdminController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  async list(
    @Query('query') query?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Number.parseInt(limit ?? '', 10);
    const parsedOffset = Number.parseInt(offset ?? '', 10);
    const safeLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const safeOffset =
      Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    // Support both service versions: `listForAdmin` (paginated) or `findAll`.
    const svc = this.usersService as any;

    let items: any[];
    let total: number | undefined;

    if (typeof svc.listForAdmin === 'function') {
      // NOTE: `await` must apply to the call result, not to the method reference.
      const result = await svc.listForAdmin({
        query,
        limit: safeLimit,
        offset: safeOffset,
      });

      if (Array.isArray(result)) {
        items = result;
      } else {
        items = result?.items ?? [];
        total = result?.total;
      }
    } else {
      items = await svc.findAll(safeLimit, safeOffset);
    }

    return {
      items: items.map((u) => this.toAdminShape(u)),
      ...(total !== undefined ? { total } : {}),
    };
  }

  @Patch(':id/access-tier')
  async setAccessTier(@Param('id') id: string, @Body() dto: SetUserAccessTierDto) {
    const updated = await (this.usersService as any).setAccessTier(id, dto.accessTier);
    return this.toAdminShape(updated);
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private toAdminShape(u: any): AdminUserResponse {
    return {
      id: u.id,
      email: u.email,
      username: u.username ?? null,
      displayName: u.displayName ?? null,
      avatarSeed: u.avatarSeed ?? null,
      role: u.role,
      accessTier: u.accessTier,
      createdAt: this.toIso(u.createdAt) ?? '',
      lastLoginAt: this.toIso(u.lastLoginAt),
    };
  }

  private toIso(value: unknown): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (value instanceof Date) return value.toISOString();
    return null;
  }
}