import { NormalizedProviderError } from './errors/normalized-provider.error';

/**
 * How a provider failure should be treated by the failover policy (spec 006).
 *
 *  - `transient`     — the same provider may succeed if retried (network blip,
 *                      deadline, rate limit).
 *  - `terminal`      — the same provider will not succeed on retry; go straight
 *                      to the fallback candidate.
 *  - `configuration` — the model/provider wiring is wrong; the same provider is
 *                      not worth another attempt either.
 *
 * Every category is eligible for fallback. Only `transient` also retries the
 * same candidate.
 */
export type FailureCategory = 'transient' | 'terminal' | 'configuration';

export interface ClassifiedFailure {
  code: string;
  category: FailureCategory;
  retryable: boolean;
}

const TRANSIENT_CODES = new Set([
  'provider_unreachable',
  'provider_timeout',
  'provider_rate_limited',
  // Node/undici socket-level failures arrive with a system `code`.
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const CONFIGURATION_CODES = new Set([
  'provider_type_unsupported',
  'provider_not_found',
  'provider_inactive',
]);

/** Pull a stable code out of anything that can be thrown. */
function extractCode(err: unknown): string {
  if (err instanceof NormalizedProviderError) return err.code;
  if (err && typeof err === 'object') {
    const candidate = err as { response?: unknown; code?: unknown };
    const response = candidate.response;
    if (response && typeof response === 'object') {
      const inner = (response as { code?: unknown }).code;
      if (typeof inner === 'string' && inner.length > 0) return inner;
    }
    if (typeof candidate.code === 'string' && candidate.code.length > 0) {
      return candidate.code;
    }
  }
  return 'provider_error';
}

/**
 * Classify a provider failure.
 *
 * The result carries the code and the policy decision only — never the
 * original message, which may contain credentials or upstream internals.
 */
export function classifyProviderFailure(err: unknown): ClassifiedFailure {
  const code = extractCode(err);
  const category: FailureCategory = TRANSIENT_CODES.has(code)
    ? 'transient'
    : CONFIGURATION_CODES.has(code)
      ? 'configuration'
      : 'terminal';
  return { code, category, retryable: category === 'transient' };
}

/**
 * Normalize an error thrown while opening a provider stream into the shared
 * envelope, so classification and logging only ever see stable codes.
 *
 * Without this the OpenAI SDK's own error classes (`APIConnectionError`,
 * `APIConnectionTimeoutError`, `APIError` with a `status`) would reach the
 * failover layer unrecognized — and their messages, which can include the base
 * URL and request details, would reach the logs as structured fields.
 */
export function normalizeStreamError(err: unknown): NormalizedProviderError {
  if (err instanceof NormalizedProviderError) return err;

  const message = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : '';
  const status =
    err && typeof err === 'object' && typeof (err as { status?: unknown }).status === 'number'
      ? (err as { status: number }).status
      : undefined;

  const build = (code: string, userMessage: string, statusCode: number) =>
    new NormalizedProviderError({
      code,
      message: userMessage,
      statusCode,
      originalMessage: message,
    });

  if (name === 'APIConnectionTimeoutError') {
    return build('provider_timeout', 'Provider generation timed out.', 504);
  }
  if (name === 'APIConnectionError') {
    return build('provider_unreachable', 'Provider could not be reached.', 502);
  }

  if (status !== undefined) {
    if (status === 401 || status === 403) {
      return build('credentials_rejected', 'Provider rejected credentials.', 422);
    }
    if (status === 429) {
      return build('provider_rate_limited', 'Provider rate limit reached.', 503);
    }
    if (status === 503) {
      return build('provider_rate_limited', 'Provider temporarily unavailable.', 503);
    }
    if (status >= 500) {
      return build('provider_unreachable', 'Upstream provider error.', 502);
    }
    if (status >= 400) {
      return build('provider_request_invalid', 'The provider rejected the request.', 422);
    }
  }

  return build('provider_unreachable', 'Provider could not be reached.', 502);
}
