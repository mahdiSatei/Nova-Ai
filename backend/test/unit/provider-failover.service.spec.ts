import {
  ProviderFailoverService,
  AllProvidersUnavailableError,
  MAX_ATTEMPTS_PER_CANDIDATE,
} from '../../src/modules/provider/provider-failover.service';
import { ProviderAttemptMetrics } from '../../src/modules/provider/provider-attempt-metrics.service';
import { NormalizedProviderError } from '../../src/modules/provider/errors/normalized-provider.error';

const primary = {
  id: 'model-primary',
  actualName: 'gpt-primary',
  providerId: 'openai',
  enabled: true,
  fallbackModelId: 'model-backup',
} as never;

const backup = {
  id: 'model-backup',
  actualName: 'llama-backup',
  providerId: 'groq',
  enabled: true,
  fallbackModelId: null,
} as never;

function strayStream() {
  return (async function* () {
    /* empty stream */
  })();
}

function transient() {
  return new NormalizedProviderError({
    code: 'provider_timeout',
    message: 'Provider generation timed out.',
    statusCode: 504,
    originalMessage: 'Generation exceeded 120000ms',
  });
}

function terminal() {
  return new NormalizedProviderError({
    code: 'credentials_rejected',
    message: 'Provider rejected credentials.',
    statusCode: 422,
    originalMessage: 'HTTP 401',
  });
}

function build(opts: {
  runtime?: Partial<{ assertReady: jest.Mock; stream: jest.Mock }>;
  models?: Partial<{ findById: jest.Mock }>;
} = {}) {
  const metrics = new ProviderAttemptMetrics();
  const runtime = {
    assertReady: jest.fn().mockResolvedValue({ provider: { id: 'openai' }, adapter: {} }),
    stream: jest.fn().mockResolvedValue(strayStream()),
    ...opts.runtime,
  };
  const models = { findById: jest.fn().mockResolvedValue(backup), ...opts.models };
  const service = new ProviderFailoverService(runtime as never, models as never, metrics);
  return { service, runtime, models, metrics };
}

const messages = [{ role: 'user' as const, content: 'hi' }];
const alwaysAllowed = () => true;

describe('ProviderFailoverService', () => {
  it('returns the primary on first-attempt success with one attempt recorded', async () => {
    const { service, metrics } = build();
    const result = await service.establish({ model: primary, messages, isAllowed: alwaysAllowed });

    expect(result.model).toBe(primary);
    expect(result.attempts).toBe(1);
    expect(result.failures).toEqual([]);
    expect(metrics.snapshot().fallbacks).toBe(0);
  });

  it('retries the same provider once on a transient failure', async () => {
    const stream = jest
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce(strayStream());
    const { service } = build({ runtime: { stream } });

    const result = await service.establish({ model: primary, messages, isAllowed: alwaysAllowed });

    expect(stream).toHaveBeenCalledTimes(2);
    expect(result.model).toBe(primary);
    expect(result.attempts).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].category).toBe('transient');
  });

  it('does not retry a terminal failure', async () => {
    const stream = jest.fn().mockRejectedValueOnce(terminal());
    const { service } = build({
      runtime: { stream },
      models: { findById: jest.fn().mockResolvedValue(backup) },
    });

    const result = await service.establish({ model: primary, messages, isAllowed: alwaysAllowed });

    expect(stream).toHaveBeenCalledTimes(2); // primary once, backup once
    expect(result.model).toBe(backup);
    expect(result.attempts).toBe(2);
  });

  it('falls back to the configured model when the primary is exhausted', async () => {
    const stream = jest
      .fn()
      .mockRejectedValueOnce(transient())
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce(strayStream());
    const { service, metrics } = build({ runtime: { stream } });

    const result = await service.establish({ model: primary, messages, isAllowed: alwaysAllowed });

    expect(result.model).toBe(backup);
    expect(result.attempts).toBe(3);
    expect(result.failures.map((f) => f.modelId)).toEqual(['model-primary', 'model-primary']);
    expect(metrics.snapshot().fallbacks).toBe(1);
  });

  it('never selects a fallback the caller is not entitled to', async () => {
    const stream = jest.fn().mockRejectedValue(transient());
    const { service } = build({ runtime: { stream } });

    await expect(
      service.establish({
        model: primary,
        messages,
        isAllowed: (m) => (m as { id: string }).id !== 'model-backup',
      }),
    ).rejects.toBeInstanceOf(AllProvidersUnavailableError);
  });

  it('never selects a disabled fallback', async () => {
    const stream = jest.fn().mockRejectedValue(transient());
    const { service } = build({
      runtime: { stream },
      models: { findById: jest.fn().mockResolvedValue({ ...(backup as object), enabled: false }) },
    });

    await expect(
      service.establish({ model: primary, messages, isAllowed: alwaysAllowed }),
    ).rejects.toBeInstanceOf(AllProvidersUnavailableError);
  });

  it('ignores a fallback pointing at the model itself', async () => {
    const stream = jest.fn().mockRejectedValue(terminal());
    const self = { ...(primary as object), fallbackModelId: 'model-primary' };
    const { service, models } = build({ runtime: { stream } });

    await expect(
      service.establish({ model: self as never, messages, isAllowed: alwaysAllowed }),
    ).rejects.toBeInstanceOf(AllProvidersUnavailableError);
    expect(models.findById).not.toHaveBeenCalledWith('model-primary');
  });

  it('reports every attempt and never leaks the original message on total failure', async () => {
    const stream = jest.fn().mockRejectedValue(
      new NormalizedProviderError({
        code: 'credentials_rejected',
        message: 'Provider rejected credentials.',
        statusCode: 422,
        originalMessage: 'sk-secret-abc',
      }),
    );
    const { service, metrics } = build({ runtime: { stream } });

    const err = await service
      .establish({ model: primary, messages, isAllowed: alwaysAllowed })
      .catch((e) => e as AllProvidersUnavailableError);

    expect(err.attempts).toBe(2);
    expect(err.failures.map((f) => f.code)).toEqual([
      'credentials_rejected',
      'credentials_rejected',
    ]);
    expect(JSON.stringify(err)).not.toContain('sk-secret-abc');
    expect(metrics.snapshot().failuresByCode.credentials_rejected).toBe(2);
  });

  it('does not emit a retry callback for a terminal failure', async () => {
    const stream = jest
      .fn()
      .mockRejectedValueOnce(terminal())
      .mockResolvedValueOnce(strayStream());
    const { service } = build({ runtime: { stream } });
    const seen: number[] = [];

    await service.establish({
      model: primary,
      messages,
      isAllowed: alwaysAllowed,
      onRetry: ({ attempt }) => seen.push(attempt),
    });

    expect(seen).toEqual([]);
  });

  it('emits a retry callback before re-attempting a transient failure', async () => {
    const stream = jest
      .fn()
      .mockRejectedValueOnce(transient())
      .mockResolvedValueOnce(strayStream());
    const { service } = build({ runtime: { stream } });
    const seen: number[] = [];

    await service.establish({
      model: primary,
      messages,
      isAllowed: alwaysAllowed,
      onRetry: ({ attempt, maxAttempts }) => {
        expect(maxAttempts).toBe(MAX_ATTEMPTS_PER_CANDIDATE);
        seen.push(attempt);
      },
    });

    expect(seen).toEqual([2]);
  });
});
