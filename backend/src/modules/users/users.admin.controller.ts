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
  accessTier?: string; // اضافه شده از HEAD
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
    const safeOffset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? parsedOffset : 0;

    // پشتیبانی از متد service هر دو نسخه (اگر متد listForAdmin وجود داشت یا findAll)
    const result = await (this.usersService as any).listForAdmin
      ? (this.usersService as any).listForAdmin({ query, limit: safeLimit, offset: safeOffset })
      : { items: await this.usersService.findAll(safeLimit, safeOffset), total: undefined };

    const items = result.items || result;
    return { 
      items: items.map((u: any) => this.toAdminShape(u)), 
      ...(result.total !== undefined ? { total: result.total } : {}) 
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
      username: u.username,
      displayName: u.displayName ?? null,
      avatarSeed: u.avatarSeed ?? null,
      role: u.role,
      accessTier: u.accessTier,
      createdAt: typeof u.createdAt === 'string' ? u.createdAt : u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? (typeof u.lastLoginAt === 'string' ? u.lastLoginAt : u.lastLoginAt.toISOString()) : null,
    };
  }
}