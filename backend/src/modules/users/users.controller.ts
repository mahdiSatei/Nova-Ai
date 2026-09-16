import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsersService } from './users.service';
import { UpdateMeRequestDto } from './dto/update-me.dto';

/**
 * Profile endpoints for the authenticated user ("me"). All routes
 * require authentication; the target user is always the caller.
 */
@Controller('v1/users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  /**
   * The caller's profile. Password hash is never part of the response.
   */
  @Get('me')
  async me(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    role: 'user' | 'admin';
    createdAt: string;
    lastLoginAt: string | null;
  }> {
    const me = await this.users.findById(user.id);
    return this.toProfile(me);
  }

  /**
   * Update the caller's display name. Trimmed; whitespace-only clears.
   */
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeRequestDto,
  ): Promise<{
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    role: 'user' | 'admin';
    createdAt: string;
    lastLoginAt: string | null;
  }> {
    const trimmed = dto.displayName.trim();
    const updated = await this.users.updateDisplayName(user.id, trimmed === '' ? null : trimmed);
    return this.toProfile(updated);
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private toProfile(u: {
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    role: 'user' | 'admin';
    createdAt: Date;
    lastLoginAt?: Date | null;
  }): {
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    role: 'user' | 'admin';
    createdAt: string;
    lastLoginAt: string | null;
  } {
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    };
  }
}
