import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import type { User } from './entities/user.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Admin-only user directory (spec 003 §Scope — "Associate models with the
 * required role, subscription, or user group").
 *
 * Deliberately narrow: this surface lists accounts and their role. The former
 * entitlement-tier assignment was removed in phase 5 (the credit wallet
 * replaced access tiers). It is NOT account administration (no create, disable,
 * delete, or password reset) — that remains out of scope per spec 001.
 */
@Controller('v1/admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsersAdminController {
  constructor(private readonly users: UsersService) {}

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

    const { items, total } = await this.users.listForAdmin({
      query,
      limit: safeLimit,
      offset: safeOffset,
    });
    return { items: items.map((u) => this.toAdminUser(u)), total };
  }

  private toAdminUser(u: User) {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    };
  }
}
