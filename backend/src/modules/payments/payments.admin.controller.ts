import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ListAdminPaymentsQueryDto } from './dto/list-admin-payments-query.dto';
import { ListAdminPurchasesQueryDto } from './dto/list-admin-purchases-query.dto';
import { PaymentsService } from './payments.service';

const DEFAULT_LIMIT = 20;

@Controller('v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PaymentsAdminController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  async listPayments(@Query() query: ListAdminPaymentsQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const result = await this.payments.listPaymentsForAdmin({
      userId: query.userId,
      status: query.status,
      limit,
      offset,
    });

    return { ...result, limit, offset };
  }

  @Get('credit-purchases')
  async listPurchases(@Query() query: ListAdminPurchasesQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const result = await this.payments.listPurchasesForAdmin({
      userId: query.userId,
      status: query.status,
      limit,
      offset,
    });

    return { ...result, limit, offset };
  }

  /**
   * Re-check a payment that is still `PENDING` with the provider.
   *
   * The recovery path for a provider outage during the browser callback: the
   * user paid, we could not confirm it, so someone has to be able to ask again.
   */
  @Post('payments/:id/reconcile')
  @HttpCode(200)
  reconcile(@Param('id') id: string) {
    return this.payments.reconcile(id);
  }
}
