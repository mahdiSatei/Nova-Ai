import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreditPurchase } from './entities/credit-purchase.entity';
import { Payment } from './entities/payment.entity';
import {
  PaymentProvider,
  PAYMENT_PROVIDER,
  ProviderVerification,
} from './payment-provider.interface';
import {
  CreditPurchaseStatus,
  isTerminalPaymentStatus,
  PaymentStatus,
} from './payment-status';
import { WalletService } from '../wallet/wallet.service';
import { AuditService } from '../audit/audit.service';

/** Upper bound on a single purchase, so a typo cannot create a 100M-Toman bill. */
export const MAX_AMOUNT_TOMAN = 500_000_000;

export interface CreatePurchaseResult {
  purchaseId: string;
  paymentId: string;
  credits: number;
  amountToman: number;
  pricePerCreditToman: number;
  trackId: string;
  paymentUrl: string;
}

/**
 * A payment as exposed over the API.
 *
 * Deliberately has no `credits` field: a payment row does not carry one, and
 * filling it in would need a per-row purchase lookup to repeat a number the
 * caller already received when it created the purchase (`CreatePurchaseResult`)
 * or can read from the admin purchases list.
 */
export interface PaymentView {
  id: string;
  purchaseId: string;
  status: PaymentStatus;
  provider: string;
  amountToman: number;
  trackId: string | null;
  reference: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface CreditPurchaseView {
  id: string;
  userId: string;
  credits: number;
  amountToman: number;
  pricePerCreditToman: number;
  status: CreditPurchaseStatus;
  paymentId: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface ListPaymentsQuery {
  status?: PaymentStatus;
  limit: number;
  offset: number;
}

export interface ListAdminQuery {
  userId?: string;
  status?: PaymentStatus;
  limit: number;
  offset: number;
}

export interface ListAdminPurchasesQuery {
  userId?: string;
  status?: CreditPurchaseStatus;
  limit: number;
  offset: number;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment) private readonly paymentsRepo: Repository<Payment>,
    @InjectRepository(CreditPurchase)
    private readonly purchasesRepo: Repository<CreditPurchase>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly walletService: WalletService,
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async createPurchase(userId: string, credits: number): Promise<CreatePurchaseResult> {
    if (!Number.isInteger(credits) || credits <= 0) {
      throw new BadRequestException({
        code: 'invalid_credits',
        message: 'Credits must be a positive whole number.',
      });
    }

    this.assertPaymentConfigured();

    // Credits are sold at the same rate the billing layer uses to convert usage
    // cost into Credits, so buying and spending can never disagree.
    const pricePerCreditToman = this.config.get<number>('billing.creditPriceToman') ?? 100;
    const amountToman = credits * pricePerCreditToman;
    if (amountToman > MAX_AMOUNT_TOMAN) {
      throw new BadRequestException({
        code: 'amount_too_large',
        message: `Purchase amount may not exceed ${MAX_AMOUNT_TOMAN} Toman.`,
      });
    }

    const purchase = await this.purchasesRepo.save(
      this.purchasesRepo.create({
        userId,
        credits,
        pricePerCreditToman,
        amountToman,
        currency: 'IRT',
        status: 'PENDING' as CreditPurchaseStatus,
        paymentId: null,
        completedAt: null,
      }),
    );

    let request: Awaited<ReturnType<PaymentProvider['createPayment']>>;
    try {
      request = await this.provider.createPayment({
        amountToman,
        orderId: purchase.id,
        description: `${credits} credits`,
      });
    } catch (error) {
      this.logger.warn(`Payment provider refused purchase ${purchase.id}: ${String(error)}`);
      await this.purchasesRepo.update({ id: purchase.id }, { status: 'FAILED' });
      throw new ServiceUnavailableException({
        code: 'payment_provider_unavailable',
        message: 'Payment provider is unavailable, please try again.',
      });
    }

    const payment = await this.paymentsRepo.save(
      this.paymentsRepo.create({
        creditPurchaseId: purchase.id,
        userId,
        provider: this.provider.name,
        status: 'PENDING' as PaymentStatus,
        amountToman,
        providerAmountRial: String(request.providerAmountRial),
        currency: 'IRR',
        providerTrackId: request.trackId,
        providerReference: null,
        providerStatus: null,
        providerRawData: null,
        paidAt: null,
      }),
    );

    await this.purchasesRepo.update({ id: purchase.id }, { paymentId: payment.id });

    // Fire-and-forget audit: payment creation.
    void this.audit.log({
      actorId: userId,
      action: 'payment_created',
      targetType: 'payment',
      targetId: payment.id,
      metadata: { credits, amountToman, provider: this.provider.name },
    });

    return {
      purchaseId: purchase.id,
      paymentId: payment.id,
      credits,
      amountToman,
      pricePerCreditToman,
      trackId: request.trackId,
      paymentUrl: request.paymentUrl,
    };
  }

  async verifyAndFinalize(trackId: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({
      where: { providerTrackId: trackId },
    });
    if (!payment) {
      throw new NotFoundException({
        code: 'payment_not_found',
        message: 'Payment not found.',
      });
    }
    if (isTerminalPaymentStatus(payment.status)) {
      return payment;
    }

    const verification = await this.provider.verifyPayment(trackId);

    if (verification.status === 'PROVIDER_UNAVAILABLE') {
      return this.recordAttempt(payment, verification);
    }

    if (verification.status === 'SUCCESS') {
      const expected = payment.providerAmountRial;
      const actual = verification.providerAmountRial;
      // `providerAmountRial` is a bigint column, so it arrives as a string.
      // Compare as BigInt: `Number` would silently round large amounts.
      const matches =
        expected === null || actual === null || BigInt(expected) === BigInt(actual);
      if (!matches) {
        this.logger.warn(
          `Payment ${payment.id} amount mismatch: expected ${String(expected)} rial, got ${String(actual)}`,
        );
        return this.finalize(payment.id, 'FAILED', verification);
      }
      const result = await this.finalize(payment.id, 'SUCCESS', verification);
      void this.audit.log({
        actorId: payment.userId,
        action: 'payment_succeeded',
        targetType: 'payment',
        targetId: payment.id,
        metadata: { amountToman: payment.amountToman, provider: payment.provider },
      });
      return result;
    }

    const nextStatus: PaymentStatus =
      verification.status === 'NOT_PAID' ? 'CANCELLED' : 'FAILED';
    const result = await this.finalize(payment.id, nextStatus, verification);
    void this.audit.log({
      actorId: payment.userId,
      action: 'payment_failed',
      targetType: 'payment',
      targetId: payment.id,
      metadata: { amountToman: payment.amountToman, provider: payment.provider, status: nextStatus },
    });
    return result;
  }

  /**
   * Re-check a payment that is still pending (admin recovery path).
   *
   * Needed because `PROVIDER_UNAVAILABLE` deliberately leaves a payment open:
   * the user may have paid, and we were simply unable to find out.
   */
  async reconcile(paymentId: string): Promise<Payment> {
    const payment = await this.paymentsRepo.findOne({ where: { id: paymentId } });
    if (!payment) {
      throw new NotFoundException({
        code: 'payment_not_found',
        message: 'Payment not found.',
      });
    }
    if (isTerminalPaymentStatus(payment.status) || !payment.providerTrackId) {
      return payment;
    }
    return this.verifyAndFinalize(payment.providerTrackId);
  }

  /**
   * The one place a payment becomes terminal.
   *
   * The `WHERE status = 'PENDING'` guard IS the idempotency mechanism: when two
   * callbacks race, exactly one UPDATE reports a row, and only that winner is
   * allowed to grant credits.
   */
  private async finalize(
    paymentId: string,
    status: PaymentStatus,
    verification: ProviderVerification,
  ): Promise<Payment> {
    return this.dataSource.transaction(async (manager) => {
      const updated: Array<{ id: string }> = await manager.query(
        `UPDATE payments
            SET status = $2,
                provider_status = $3,
                provider_reference = $4,
                provider_raw_data = $5,
                paid_at = $6,
                updated_at = now()
          WHERE id = $1 AND status = 'PENDING'
          RETURNING id`,
        [
          paymentId,
          status,
          verification.raw?.result === undefined ? null : String(verification.raw.result),
          verification.reference,
          JSON.stringify(verification.raw ?? {}),
          status === 'SUCCESS' ? (verification.paidAt ?? new Date()) : null,
        ],
      );

      const payment = await manager.findOne(Payment, { where: { id: paymentId } });
      if (!payment) {
        throw new NotFoundException({
          code: 'payment_not_found',
          message: 'Payment not found.',
        });
      }

      if (updated.length === 0) {
        // Another writer won the race and owns the credit grant.
        return payment;
      }

      const purchase = await manager.findOne(CreditPurchase, {
        where: { id: payment.creditPurchaseId },
      });
      if (!purchase) {
        throw new NotFoundException({
          code: 'purchase_not_found',
          message: 'Credit purchase not found.',
        });
      }

      if (status === 'SUCCESS') {
        await this.walletService.grantCreditsWithin(manager, payment.userId, purchase.credits);
        await manager.update(
          CreditPurchase,
          { id: purchase.id },
          { status: 'COMPLETED' as CreditPurchaseStatus, completedAt: new Date() },
        );
      } else {
        await manager.update(CreditPurchase, { id: purchase.id }, {
          status: (status === 'CANCELLED' ? 'CANCELLED' : 'FAILED') as CreditPurchaseStatus,
        });
      }

      return payment;
    });
  }

  /**
   * Record a failed verification attempt without changing the payment state.
   *
   * Uses raw SQL for the `jsonb` column, like `finalize` does: TypeORM's
   * deep-partial update type cannot express a `Record<string, unknown>` column,
   * and a cast there would hide exactly the kind of bug this column exists to
   * diagnose.
   */
  private async recordAttempt(
    payment: Payment,
    verification: ProviderVerification,
  ): Promise<Payment> {
    const providerStatus = String(verification.raw?.result ?? 'unknown');
    await this.paymentsRepo.query(
      `UPDATE payments
          SET provider_status = $2, provider_raw_data = $3, updated_at = now()
        WHERE id = $1`,
      [payment.id, providerStatus, JSON.stringify(verification.raw ?? {})],
    );
    return { ...payment, providerStatus } as Payment;
  }

  async getPaymentForUser(userId: string, paymentId: string): Promise<PaymentView> {
    const payment = await this.paymentsRepo.findOne({ where: { id: paymentId } });
    // Another user's payment is reported as missing, not forbidden: whether a
    // payment id exists is not something a stranger should be able to probe.
    if (!payment || payment.userId !== userId) {
      throw new NotFoundException({
        code: 'payment_not_found',
        message: 'Payment not found.',
      });
    }
    return this.toView(payment);
  }

  async listPaymentsForUser(
    userId: string,
    query: ListPaymentsQuery,
  ): Promise<Paginated<PaymentView>> {
    const [rows, total] = await this.paymentsRepo.findAndCount({
      where: { userId, ...(query.status ? { status: query.status } : {}) },
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
    return { items: rows.map((row) => this.toView(row)), total };
  }

  async listPaymentsForAdmin(query: ListAdminQuery): Promise<Paginated<PaymentView>> {
    const [rows, total] = await this.paymentsRepo.findAndCount({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
    return { items: rows.map((row) => this.toView(row)), total };
  }

  async listPurchasesForAdmin(
    query: ListAdminPurchasesQuery,
  ): Promise<Paginated<CreditPurchaseView>> {
    const [rows, total] = await this.purchasesRepo.findAndCount({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit,
      skip: query.offset,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        credits: row.credits,
        amountToman: row.amountToman,
        pricePerCreditToman: row.pricePerCreditToman,
        status: row.status,
        paymentId: row.paymentId,
        createdAt: row.createdAt,
        completedAt: row.completedAt,
      })),
      total,
    };
  }

  private toView(payment: Payment): PaymentView {
    return {
      id: payment.id,
      purchaseId: payment.creditPurchaseId,
      status: payment.status,
      provider: payment.provider,
      amountToman: payment.amountToman,
      trackId: payment.providerTrackId,
      reference: payment.providerReference,
      createdAt: payment.createdAt,
      paidAt: payment.paidAt,
    };
  }

  /**
   * Credit purchases are optional configuration (like web search). When they are
   * not configured, say so plainly instead of creating a purchase that could
   * never be paid for.
   */
  private assertPaymentConfigured(): void {
    const merchant = this.config.get<string>('payment.zibal.merchant');
    const callbackUrl = this.config.get<string>('payment.zibal.callbackUrl');
    if (!merchant || !callbackUrl) {
      throw new ServiceUnavailableException({
        code: 'payment_not_configured',
        message: 'Credit purchases are not configured on this deployment.',
      });
    }
  }
}
