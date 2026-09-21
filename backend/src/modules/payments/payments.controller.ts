import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { CreateCreditPurchaseDto } from './dto/create-credit-purchase.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { ZibalCallbackDto } from './dto/zibal-callback.dto';
import { PaymentsService } from './payments.service';
import { PaymentStatus } from './payment-status';

const DEFAULT_LIMIT = 20;

/** Lower-case statuses for the frontend's result page. */
const CALLBACK_STATUS: Record<PaymentStatus, string> = {
  SUCCESS: 'success',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  // Not a failure: the provider could not be reached, so the payment is still
  // open and the frontend should say "we are checking", not "payment failed".
  PENDING: 'pending',
};

@Controller('v1')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  @Post('credit-purchases')
  @HttpCode(201)
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateCreditPurchaseDto) {
    return this.payments.createPurchase(user.id, body.credits);
  }

  // Declared BEFORE `payments/:id`: Express matches routes in declaration order,
  // so this must stay above the parametrised read or the callback resolves to
  // `:id` and 404s.
  @Public()
  @Get('payments/zibal/callback')
  @Header('Cache-Control', 'no-store')
  async callback(@Query() query: ZibalCallbackDto, @Res() res: Response): Promise<void> {
    const target = new URL(this.config.get<string>('payment.resultRedirectUrl') as string);

    try {
      const payment = await this.payments.verifyAndFinalize(query.trackId);
      target.searchParams.set('paymentId', payment.id);
      target.searchParams.set('status', CALLBACK_STATUS[payment.status]);
    } catch {
      // An unknown or unusable trackId is not an error the browser can act on.
      target.searchParams.set('status', 'not_found');
    }

    res.redirect(302, target.toString());
  }

  @Get('payments')
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPaymentsQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const result = await this.payments.listPaymentsForUser(user.id, {
      status: query.status,
      limit,
      offset,
    });

    return { ...result, limit, offset };
  }

  @Get('payments/:id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payments.getPaymentForUser(user.id, id);
  }
}
