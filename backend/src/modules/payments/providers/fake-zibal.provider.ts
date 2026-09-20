import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateProviderPaymentInput,
  PaymentProvider,
  PaymentProviderName,
  ProviderPaymentRequest,
  ProviderVerification,
  ProviderVerificationStatus,
} from '../payment-provider.interface';

/** Zibal `result` codes. */
const RESULT_SUCCESS = 100;
const RESULT_ALREADY_VERIFIED = 201;
const RESULT_NOT_PAID = 202;
const RESULT_INVALID_TRACK_ID = 203;
const RESULT_PROVIDER_UNAVAILABLE = 503;
const RESULT_TRANSPORT_FAILURE = -2;

/**
 * A non-2xx response that still carried a JSON body.
 *
 * Kept as a distinct type so callers can tell "the gateway answered with an
 * error" apart from "we never reached the gateway" — both mean unavailable,
 * but only the first has a body worth persisting.
 */
export class ProviderHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly payload: Record<string, unknown>,
  ) {
    super(`payment_provider_http_${status}`);
    this.name = 'ProviderHttpError';
  }
}

/**
 * The Zibal client.
 *
 * Named "fake" because the configuration this repo ships points it at the
 * bundled fake gateway (`ZIBAL_BASE_URL=http://127.0.0.1:3010`), but the code
 * path is the real one: same endpoints, same JSON, same result codes. Point
 * `ZIBAL_BASE_URL` at `https://gateway.zibal.ir` and it talks to production.
 */
@Injectable()
export class FakeZibalProvider implements PaymentProvider {
  readonly name: PaymentProviderName = 'ZIBAL';
  private readonly logger = new Logger(FakeZibalProvider.name);

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    return this.config.get<string>('payment.zibal.baseUrl') as string;
  }

  private get merchant(): string {
    return this.config.get<string>('payment.zibal.merchant') as string;
  }

  private get callbackUrl(): string {
    return this.config.get<string>('payment.zibal.callbackUrl') as string;
  }

  private get timeoutMs(): number {
    return this.config.get<number>('payment.zibal.timeoutMs') ?? 10_000;
  }

  toProviderAmount(amountToman: number): number {
    if (!Number.isInteger(amountToman)) {
      throw new Error('amountToman must be an integer Toman amount');
    }
    return amountToman * 10;
  }

  buildPaymentUrl(trackId: string): string {
    return `${this.baseUrl}/start/${trackId}`;
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<ProviderPaymentRequest> {
    const providerAmountRial = this.toProviderAmount(input.amountToman);
    const payload = await this.post('/v1/request', {
      merchant: this.merchant,
      amount: providerAmountRial,
      orderId: input.orderId,
      description: input.description,
      callbackUrl: this.callbackUrl,
    });

    if (payload.result !== RESULT_SUCCESS || !payload.trackId) {
      this.logger.warn(`Zibal request rejected: ${JSON.stringify(payload)}`);
      throw new Error(`payment_provider_error: ${String(payload.result)}`);
    }

    const trackId = String(payload.trackId);
    return {
      trackId,
      providerAmountRial,
      paymentUrl: this.buildPaymentUrl(trackId),
    };
  }

  async verifyPayment(trackId: string): Promise<ProviderVerification> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.post('/v1/verify', { merchant: this.merchant, trackId });
    } catch (error) {
      // A transport failure is information about the payment, not a crash.
      this.logger.warn(`Zibal verify transport failure for ${trackId}: ${String(error)}`);
      return {
        status: 'PROVIDER_UNAVAILABLE',
        providerAmountRial: null,
        reference: null,
        paidAt: null,
        raw: error instanceof ProviderHttpError ? error.payload : { error: String(error) },
      };
    }

    const amount = typeof payload.amount === 'number' ? payload.amount : null;
    const reference = typeof payload.refNumber === 'string' ? payload.refNumber : null;
    const paidAt =
      typeof payload.paidAt === 'string' && !Number.isNaN(Date.parse(payload.paidAt))
        ? new Date(payload.paidAt)
        : null;

    return {
      status: this.mapResult(payload.result),
      providerAmountRial: amount,
      reference,
      paidAt,
      raw: payload,
    };
  }

  private mapResult(result: unknown): ProviderVerificationStatus {
    switch (result) {
      case RESULT_SUCCESS:
      case RESULT_ALREADY_VERIFIED:
        // 201 means we already verified this transaction — still a success, and
        // still exactly-once on our side because finalization guards on PENDING.
        return 'SUCCESS';
      case RESULT_NOT_PAID:
        return 'NOT_PAID';
      case RESULT_PROVIDER_UNAVAILABLE:
      case RESULT_TRANSPORT_FAILURE:
        return 'PROVIDER_UNAVAILABLE';
      case RESULT_INVALID_TRACK_ID:
      default:
        return 'INVALID_TRANSACTION';
    }
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = { raw: text };
      }

      if (!response.ok) {
        // A 5xx is never a statement about the payment: it means the gateway
        // is having trouble, so the amount and status in any body it did send
        // are meaningless. Fail the call, not the payment.
        throw new ProviderHttpError(response.status, parsed);
      }

      return parsed;
    } finally {
      clearTimeout(timer);
    }
  }
}
