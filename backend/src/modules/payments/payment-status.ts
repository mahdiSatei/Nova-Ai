export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';

export type CreditPurchaseStatus = 'PENDING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

/**
 * A payment in one of these states can never change again. Every transition
 * guards on `status = 'PENDING'`, so this is what makes finalization
 * idempotent: a replayed callback finds a terminal payment and returns early.
 */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  'SUCCESS',
  'FAILED',
  'CANCELLED',
];

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}
