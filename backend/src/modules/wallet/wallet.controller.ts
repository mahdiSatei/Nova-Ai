import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { WalletService } from './wallet.service';

@Controller('v1/wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get()
  async getBalance(@CurrentUser() user: AuthenticatedUser): Promise<{ creditBalance: number }> {
    return { creditBalance: await this.wallet.getBalance(user.id) };
  }
}
