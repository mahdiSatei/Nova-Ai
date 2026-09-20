import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsersService } from './users.service';

/** Admin listing shape (never includes password fields). */
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
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<AdminUserResponse[]> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const users = await this.usersService.findAll(parsedLimit, parsedOffset);
    return users.map((u) => this.toAdminShape(u));
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private toAdminShape(u: {
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    avatarSeed: string | null;
    role: 'user' | 'admin';
    createdAt: Date;
    lastLoginAt?: Date | null;
  }): AdminUserResponse {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      avatarSeed: u.avatarSeed,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    };
  }
}
