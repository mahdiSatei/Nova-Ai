/** DI token for the active payment provider. */
export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export type PaymentProviderName = 'ZIBAL';

export interface CreateProviderPaymentInput {
  /** Integer Toman. The provider layer is responsible for converting to rial. */
  amountToman: number;
  /** Our own reference (the credit purchase id), echoed back for reconciliation. */
  orderId: string;
  description?: string;
}

export interface ProviderPaymentRequest {
  trackId: string;
  /** The amount actually sent to the provider, in rial. */
  providerAmountRial: number;
  /** Absolute URL the browser must be redirected to. */
  paymentUrl: string;
}

export type ProviderVerificationStatus =
  | 'SUCCESS'
  | 'NOT_PAID'
  | 'INVALID_TRANSACTION'
  | 'PROVIDER_UNAVAILABLE';

export interface ProviderVerification {
  status: ProviderVerificationStatus;
  /** rial, as reported by the provider. Null when the provider reported nothing. */
  providerAmountRial: number | null;
  reference: string | null;
  paidAt: Date | null;
  /** Raw provider response, persisted on the payment row for forensics. */
  raw: Record<string, unknown>;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** Toman → the provider's currency (rial). */
  toProviderAmount(amountToman: number): number;
  createPayment(input: CreateProviderPaymentInput): Promise<ProviderPaymentRequest>;
  buildPaymentUrl(trackId: string): string;
  /**
   * Ask the provider what really happened.
   *
   * Must RESOLVE for any provider-side problem (outage, timeout, bad response)
   * and only throw for programming errors: the caller is reading the state of a
   * payment the user may already have paid, so crashing would lose that
   * information.
   */
  verifyPayment(trackId: string): Promise<ProviderVerification>;
}
