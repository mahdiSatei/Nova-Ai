import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';
import type { User } from './entities/user.entity';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

interface AdminUserResponse {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatarSeed: string | null;
  role: 'user' | 'admin';
  createdAt: string;
  lastLoginAt: string | null;
}

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
      Number.isFinite(parsedOffset) && parsedOffset > 0
        ? parsedOffset
        : 0;

    const result = await this.usersService.listForAdmin({
      query,
      limit: safeLimit,
      offset: safeOffset,
    });

    return {
      items: result.items.map((u) => this.toAdminShape(u)),
      total: result.total,
    };
  }

  private toAdminShape(u: User): AdminUserResponse {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName ?? null,
      avatarSeed: u.avatarSeed ?? null,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    };
  }
}