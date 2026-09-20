/**
 * Mid-stream credit accounting for chat generations (spec Phase 3 §3.8).
 *
 * Providers report token usage only at the end of a stream, so budget checks
 * run on a character-based estimate. Three chars per token deliberately
 * OVERestimates cost for prose (English averages ~4 chars/token), which stops
 * a generation slightly early instead of overshooting the boundary — the safe
 * direction for a billing guard.
 */
export const CREDIT_EXHAUSTION_GRACE_CREDITS = 5;
export const CHARS_PER_TOKEN_ESTIMATE = 3;

/** Conservative tokens-for-chars estimate; rounds up. */
export function estimateOutputTokens(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

export interface CreditBudget {
  /** Credits this turn may consume: balance at stream start + grace. */
  readonly boundaryCredits: number;
  /** True when the estimated spend has crossed the boundary. */
  exceeded(estimatedCredits: number): boolean;
}

export function createCreditBudget(boundaryCredits: number): CreditBudget {
  return {
    boundaryCredits,
    exceeded: (estimatedCredits: number) => estimatedCredits > boundaryCredits,
  };
}
