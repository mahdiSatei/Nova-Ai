/**
 * Normalized error envelope for all provider failures. The chat service
 * catches this and emits a sanitized SSE error event — no raw provider
 * errors reach the client or crash the application.
 */
export class NormalizedProviderError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly originalMessage: string;

  constructor(opts: { code: string; message: string; statusCode: number; originalMessage: string }) {
    super(opts.message);
    this.name = 'NormalizedProviderError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.originalMessage = opts.originalMessage;
    Object.setPrototypeOf(this, NormalizedProviderError.prototype);
  }
}
