import {
  BadRequestException,
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

/** Public profile shape (never includes password fields). */
interface ProfileResponse {
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
  async me(@CurrentUser() user: AuthenticatedUser): Promise<ProfileResponse> {
    const me = await this.users.findById(user.id);
    return this.toProfile(me);
  }

  /**
   * Partial profile update. At least one field must be present.
   * displayName: trimmed; whitespace-only clears. avatarSeed: stored
   * verbatim (client sends a UUID).
   */
  @Patch('me')
  async updateMe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateMeRequestDto,
  ): Promise<ProfileResponse> {
    const patch: { displayName?: string | null; avatarSeed?: string } = {};

    if (dto.displayName !== undefined) {
      const trimmed = dto.displayName.trim();
      patch.displayName = trimmed === '' ? null : trimmed;
    }
    if (dto.avatarSeed !== undefined) {
      patch.avatarSeed = dto.avatarSeed;
    }

    if (Object.keys(patch).length === 0) {
      throw new BadRequestException({
        code: 'empty_patch',
        message: 'Provide at least one of: displayName, avatarSeed.',
      });
    }

    const updated = await this.users.updateProfile(user.id, patch);
    return this.toProfile(updated);
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private toProfile(u: {
    id: string;
    email: string;
    username: string | null;
    displayName: string | null;
    avatarSeed: string | null;
    role: 'user' | 'admin';
    createdAt: Date;
    lastLoginAt?: Date | null;
  }): ProfileResponse {
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
