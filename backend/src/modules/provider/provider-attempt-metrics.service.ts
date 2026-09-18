import { Injectable } from '@nestjs/common';

/**
 * In-process counters for provider stream establishment (spec 006).
 *
 * There is no metrics backend in this project, so these counters exist to make
 * fallback and retry behaviour observable through the admin API. They reset on
 * restart and are intentionally not persisted — they describe the running
 * process, not history.
 */
export interface ProviderMetricsSnapshot {
  attempts: number;
  successes: number;
  failures: number;
  fallbacks: number;
  failuresByCode: Record<string, number>;
}

@Injectable()
export class ProviderAttemptMetrics {
  private attempts = 0;
  private successes = 0;
  private failures = 0;
  private fallbacks = 0;
  private readonly failuresByCode: Record<string, number> = {};

  recordAttempt(): void {
    this.attempts++;
  }

  recordSuccess(): void {
    this.successes++;
  }

  recordFailure(code: string): void {
    this.failures++;
    this.failuresByCode[code] = (this.failuresByCode[code] ?? 0) + 1;
  }

  /** A request that succeeded on a candidate other than the first. */
  recordFallback(): void {
    this.fallbacks++;
  }

  snapshot(): ProviderMetricsSnapshot {
    return {
      attempts: this.attempts,
      successes: this.successes,
      failures: this.failures,
      fallbacks: this.fallbacks,
      failuresByCode: { ...this.failuresByCode },
    };
  }
}
