export type ReasoningErrorCode = 'invalid_reasoning_configuration' | 'reasoning_unsupported';

/**
 * Raised when a reasoning configuration is contradictory, or when reasoning is
 * explicitly requested for a model that is not configured as reasoning-capable.
 */
export class ReasoningConfigError extends Error {
  constructor(
    public readonly code: ReasoningErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReasoningConfigError';
    Object.setPrototypeOf(this, ReasoningConfigError.prototype);
  }
}
