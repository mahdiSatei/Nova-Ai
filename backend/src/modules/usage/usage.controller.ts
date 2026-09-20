import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { UsageService } from './usage.service';

@Controller('v1/usage')
@UseGuards(JwtAuthGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  @Get('me')
  async me(@CurrentUser() user: AuthenticatedUser) {
    return this.usage.getUserSummary(user.id);
  }
}
