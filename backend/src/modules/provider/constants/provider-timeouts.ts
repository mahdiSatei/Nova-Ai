/**
 * Timeout constants for provider operations.
 *
 * These are hardcoded per the spec's "Adapter/Runtime/URL Policy" task:
 *   - validation  5 s
 *   - request    15 s
 *   - generation 120 s
 */

export const PROVIDER_TIMEOUTS = Object.freeze({
  /** Maximum time allowed for credential validation (GET /models). */
  VALIDATION_MS: 5_000,
  /** Maximum time for a single provider HTTP request (non-streaming). */
  REQUEST_MS: 15_000,
  /** Maximum total time for a streaming generation. */
  GENERATION_MS: 120_000,
});
