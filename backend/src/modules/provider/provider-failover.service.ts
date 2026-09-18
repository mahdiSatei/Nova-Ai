import { Injectable, Logger } from '@nestjs/common';
import { Model } from '../models/entities/model.entity';
import { ModelsService } from '../models/models.service';
import { ProviderRuntimeService, ProviderConnection } from './provider-runtime.service';
import { ProviderChatMessage, ProviderStreamChunk } from './adapters/provider-adapter.interface';
import { classifyProviderFailure, FailureCategory } from './failure-classification';
import { ProviderAttemptMetrics } from './provider-attempt-metrics.service';

/** One initial attempt plus one retry, per candidate. */
export const MAX_ATTEMPTS_PER_CANDIDATE = 2;

/** Fixed backoff between attempts of the same candidate. */
export const RETRY_BACKOFF_MS = 250;

export interface AttemptFailure {
  modelId: string;
  providerId: string;
  /** 1-based index within this candidate's attempts; 0 when it was never tried. */
  attempt: number;
  code: string;
  category: FailureCategory;
  durationMs: number;
}

export interface EstablishedStream {
  /** The model that actually served the request — the primary, or the fallback. */
  model: Model;
  connection: ProviderConnection;
  stream: AsyncIterable<ProviderStreamChunk>;
  /** Total provider attempts made across all candidates. */
  attempts: number;
  /** Failures observed before the stream was established. */
  failures: AttemptFailure[];
}

export interface EstablishStreamInput {
  model: Model;
  messages: ProviderChatMessage[];
  /** Entitlement check supplied by the caller so access policy stays in one place. */
  isAllowed: (model: Model) => boolean | Promise<boolean>;
  /** Called immediately before re-attempting the same candidate. */
  onRetry?: (info: { attempt: number; maxAttempts: number }) => void;
}

/**
 * Raised when no candidate could establish a stream. Carries stable codes only
 * — never provider messages, base URLs or credentials.
 */
export class AllProvidersUnavailableError extends Error {
  public readonly attempts: number;
  public readonly failures: AttemptFailure[];

  constructor(failures: AttemptFailure[], attempts: number) {
    super('All provider candidates failed.');
    this.name = 'AllProvidersUnavailableError';
    this.failures = failures;
    this.attempts = attempts;
    Object.setPrototypeOf(this, AllProvidersUnavailableError.prototype);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Establishes a provider stream with bounded retry and one-hop fallback
 * (spec 006).
 *
 * Scope is deliberately narrow: this service stops at "the stream is open".
 * Once a chunk has been handed to the caller the request is never retried or
 * failed over, because replaying a partially delivered answer would append a
 * second, different response to the same message.
 */
@Injectable()
export class ProviderFailoverService {
  private readonly logger = new Logger(ProviderFailoverService.name);

  constructor(
    private readonly runtime: ProviderRuntimeService,
    private readonly models: ModelsService,
    private readonly metrics: ProviderAttemptMetrics,
  ) {}

  /**
   * The requested model first, then its configured fallback — filtered to what
   * this caller may actually use. A fallback that is disabled, missing, on an
   * inactive provider, or not entitled is dropped rather than attempted, so
   * fallback can never widen access.
   */
  async resolveCandidates(
    model: Model,
    isAllowed: (model: Model) => boolean | Promise<boolean>,
  ): Promise<Model[]> {
    const candidates: Model[] = [];
    if (model.enabled && (await isAllowed(model))) {
      candidates.push(model);
    }

    const fallbackId = model.fallbackModelId;
    if (fallbackId && fallbackId !== model.id) {
      let fallback: Model | null = null;
      try {
        fallback = await this.models.findById(fallbackId);
      } catch {
        fallback = null;
      }
      // One hop only: `fallback`'s own fallbackModelId is never followed.
      if (fallback && fallback.id !== model.id && fallback.enabled && (await isAllowed(fallback))) {
        candidates.push(fallback);
      }
    }

    return candidates;
  }

  async establish(input: EstablishStreamInput): Promise<EstablishedStream> {
    const candidates = await this.resolveCandidates(input.model, input.isAllowed);
    const failures: AttemptFailure[] = [];
    let attempts = 0;

    if (candidates.length === 0) {
      throw new AllProvidersUnavailableError(
        [
          {
            modelId: input.model.id,
            providerId: input.model.providerId,
            attempt: 0,
            code: 'model_unavailable',
            category: 'configuration',
            durationMs: 0,
          },
        ],
        0,
      );
    }

    for (let index = 0; index < candidates.length; index++) {
      const candidate = candidates[index];

      for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_CANDIDATE; attempt++) {
        const startedAt = Date.now();
        attempts++;
        this.metrics.recordAttempt();

        try {
          const connection = await this.runtime.assertReady(candidate.id);
          const stream = await this.runtime.stream(connection, {
            model: candidate.actualName,
            messages: input.messages,
          });

          this.metrics.recordSuccess();
          if (index > 0) this.metrics.recordFallback();

          return { model: candidate, connection, stream, attempts, failures };
        } catch (err) {
          const classified = classifyProviderFailure(err);
          const failure: AttemptFailure = {
            modelId: candidate.id,
            providerId: candidate.providerId,
            attempt,
            code: classified.code,
            category: classified.category,
            durationMs: Date.now() - startedAt,
          };
          failures.push(failure);
          this.metrics.recordFailure(classified.code);

          // Sanitized structured log — no originalMessage, no credentials.
          this.logger.warn(
            JSON.stringify({
              event: 'provider_attempt_failed',
              modelId: failure.modelId,
              providerId: failure.providerId,
              attempt: failure.attempt,
              code: failure.code,
              category: failure.category,
              durationMs: failure.durationMs,
              hasFallback: candidates.length > 1,
            }),
          );

          if (!classified.retryable || attempt >= MAX_ATTEMPTS_PER_CANDIDATE) break;

          input.onRetry?.({ attempt: attempt + 1, maxAttempts: MAX_ATTEMPTS_PER_CANDIDATE });
          await delay(RETRY_BACKOFF_MS);
        }
      }
    }

    throw new AllProvidersUnavailableError(failures, attempts);
  }
}
