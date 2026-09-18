import { Controller, Get, NotFoundException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { QuotaService } from './quotas.service';

/**
 * Authenticated user's own usage balance (spec 005 §Scope — "Usage and
 * remaining quota API").
 */
@Controller('v1/users/me/quota')
@UseGuards(JwtAuthGuard)
export class QuotasUserController {
  constructor(private readonly quotaService: QuotaService) {}

  @Get()
  async me(@CurrentUser() user: AuthenticatedUser) {
    const quota = await this.quotaService.getForUser(user.id);
    if (!quota) {
      throw new NotFoundException({
        code: 'quota_not_found',
        message: 'Quota is not configured for your account.',
      });
    }
    return {
      tokenLimit: quota.tokenLimit,
      tokenUsed: quota.tokenUsed,
      tokenRemaining: quota.tokenRemaining,
      costLimit: null,
      resetAt: quota.lastResetAt?.toISOString() ?? null,
    };
  }
}
