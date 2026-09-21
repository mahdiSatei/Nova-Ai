import {
  classifyProviderFailure,
  normalizeStreamError,
} from '../../src/modules/provider/failure-classification';
import { NormalizedProviderError } from '../../src/modules/provider/errors/normalized-provider.error';

describe('classifyProviderFailure', () => {
  it.each([
    ['provider_unreachable', 'transient', true],
    ['provider_timeout', 'transient', true],
    ['provider_rate_limited', 'transient', true],
    ['credentials_rejected', 'terminal', false],
    ['provider_request_invalid', 'terminal', false],
    ['provider_type_unsupported', 'configuration', false],
    ['provider_not_found', 'configuration', false],
    ['provider_inactive', 'configuration', false],
  ])('maps %s to category %s (retryable=%s)', (code, category, retryable) => {
    const result = classifyProviderFailure(
      new NormalizedProviderError({
        code,
        message: 'x',
        statusCode: 500,
        originalMessage: 'internal detail',
      }),
    );
    expect(result).toEqual({ code, category, retryable });
  });

  it('reads a Nest HttpException envelope', () => {
    const err = { response: { code: 'provider_inactive', message: 'inactive' } };
    expect(classifyProviderFailure(err)).toEqual({
      code: 'provider_inactive',
      category: 'configuration',
      retryable: false,
    });
  });

  it('treats a bare TCP network error as transient', () => {
    const err = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });
    expect(classifyProviderFailure(err)).toEqual({
      code: 'ECONNREFUSED',
      category: 'transient',
      retryable: true,
    });
  });

  it('falls back to provider_error/terminal for an unrecognised throw', () => {
    expect(classifyProviderFailure(new Error('boom'))).toEqual({
      code: 'provider_error',
      category: 'terminal',
      retryable: false,
    });
    expect(classifyProviderFailure(undefined)).toEqual({
      code: 'provider_error',
      category: 'terminal',
      retryable: false,
    });
  });

  it('never echoes the original message in its result', () => {
    const result = classifyProviderFailure(
      new NormalizedProviderError({
        code: 'credentials_rejected',
        message: 'Provider rejected credentials.',
        statusCode: 422,
        originalMessage: 'sk-secret-key-rejected-by-upstream',
      }),
    );
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });
});

describe('normalizeStreamError', () => {
  it('passes a NormalizedProviderError through unchanged', () => {
    const original = new NormalizedProviderError({
      code: 'provider_timeout',
      message: 'timed out',
      statusCode: 504,
      originalMessage: 'deadline',
    });
    expect(normalizeStreamError(original)).toBe(original);
  });

  it('maps an SDK connection timeout to provider_timeout', () => {
    const err = Object.assign(new Error('Connection timed out.'), {
      name: 'APIConnectionTimeoutError',
    });
    const out = normalizeStreamError(err);
    expect(out.code).toBe('provider_timeout');
    expect(out.statusCode).toBe(504);
  });

  it('maps an SDK connection error to provider_unreachable', () => {
    const err = Object.assign(new Error('fetch failed'), {
      name: 'APIConnectionError',
    });
    expect(normalizeStreamError(err).code).toBe('provider_unreachable');
  });

  it('maps SDK status codes to stable codes', () => {
    const withStatus = (status: number) =>
      normalizeStreamError(Object.assign(new Error(`HTTP ${status}`), { status }));
    expect(withStatus(401).code).toBe('credentials_rejected');
    expect(withStatus(403).code).toBe('credentials_rejected');
    expect(withStatus(429).code).toBe('provider_rate_limited');
    expect(withStatus(500).code).toBe('provider_unreachable');
    expect(withStatus(503).code).toBe('provider_rate_limited');
    expect(withStatus(400).code).toBe('provider_request_invalid');
    expect(withStatus(404).code).toBe('provider_request_invalid');
  });

  it('keeps the raw message server-side only', () => {
    const err = Object.assign(new Error('upstream said: invalid key sk-live-abc'), {
      status: 401,
    });
    const out = normalizeStreamError(err);
    expect(out.message).toBe('Provider rejected credentials.');
    expect(out.originalMessage).toContain('sk-live-abc');
    expect(out.message).not.toContain('sk-live-abc');
  });
});
