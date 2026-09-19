import {
  assertValidReasoningCapability,
  readStoredReasoningConfig,
  resolveReasoningConfig,
  signalsToCapability,
  toPublicReasoning,
} from '../../src/modules/reasoning/reasoning.capability';
import { ReasoningConfigError } from '../../src/modules/reasoning/reasoning.errors';
import { EMPTY_REASONING_CONFIG, StoredReasoningConfig } from '../../src/modules/reasoning/reasoning.types';

const stored = (over: Partial<StoredReasoningConfig> = {}): StoredReasoningConfig => ({
  ...EMPTY_REASONING_CONFIG,
  ...over,
});

describe('readStoredReasoningConfig', () => {
  it('returns unknowns for empty or garbage storage', () => {
    for (const raw of [{}, null, undefined, 'nope', 42, { mode: 'bogus' }]) {
      const config = readStoredReasoningConfig(raw);
      expect(config.mode).toBe('automatic');
      expect(config.discovered.supported).toBeNull();
      expect(config.discovered.output).toBeNull();
      expect(config.discovered.streaming).toBeNull();
      expect(config.discovered.sources).toEqual({
        supported: 'unknown',
        output: 'unknown',
        streaming: 'unknown',
      });
      expect(config.manual).toEqual({ supported: null, output: null, streaming: null });
    }
  });

  it('keeps a valid snapshot', () => {
    const config = readStoredReasoningConfig({
      mode: 'manual',
      discovered: {
        supported: true,
        output: 'summary',
        streaming: true,
        sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
        discoveredAt: '2026-09-19T00:00:00.000Z',
      },
      manual: { supported: true, output: 'summary', streaming: false },
    });
    expect(config.mode).toBe('manual');
    expect(config.discovered.streaming).toBe(true);
    expect(config.discovered.discoveredAt).toBe('2026-09-19T00:00:00.000Z');
    expect(config.manual.streaming).toBe(false);
  });
});

describe('resolveReasoningConfig', () => {
  it('uses discovered values in automatic mode', () => {
    const resolved = resolveReasoningConfig(
      stored({
        discovered: {
          supported: true,
          output: 'summary',
          streaming: false,
          sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
          discoveredAt: null,
        },
      }),
    );
    expect(resolved).toEqual({
      supported: true,
      output: 'summary',
      streaming: false,
      configurationSource: 'automatic',
    });
  });

  it('uses manual values in manual mode and ignores discovery', () => {
    const resolved = resolveReasoningConfig(
      stored({
        mode: 'manual',
        discovered: {
          supported: true,
          output: 'summary',
          streaming: true,
          sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
          discoveredAt: null,
        },
        manual: { supported: false, output: null, streaming: null },
      }),
    );
    expect(resolved).toEqual({
      supported: false,
      output: 'none',
      streaming: false,
      configurationSource: 'manual',
    });
  });

  it('keeps unknown when neither source could determine a capability', () => {
    const resolved = resolveReasoningConfig(stored());
    expect(resolved).toEqual({
      supported: null,
      output: null,
      streaming: null,
      configurationSource: 'automatic',
    });
  });

  it('normalizes a contradictory stored snapshot deterministically', () => {
    const resolved = resolveReasoningConfig(
      stored({
        discovered: {
          supported: false,
          output: 'summary',
          streaming: true,
          sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
          discoveredAt: null,
        },
      }),
    );
    expect(resolved).toEqual({
      supported: false,
      output: 'none',
      streaming: false,
      configurationSource: 'automatic',
    });
  });

  it('never streams reasoning that is not exposed as output', () => {
    const resolved = resolveReasoningConfig(
      stored({
        mode: 'manual',
        manual: { supported: true, output: 'none', streaming: true },
      }),
    );
    expect(resolved.streaming).toBe(false);
  });
});

describe('toPublicReasoning', () => {
  it('narrows unknown to unsupported with no output', () => {
    expect(
      toPublicReasoning({
        supported: null,
        output: null,
        streaming: null,
        configurationSource: 'automatic',
      }),
    ).toEqual({ supported: false, output: 'none', streaming: false });
  });

  it('passes a supported summary through', () => {
    expect(
      toPublicReasoning({
        supported: true,
        output: 'summary',
        streaming: true,
        configurationSource: 'manual',
      }),
    ).toEqual({ supported: true, output: 'summary', streaming: true });
  });
});

describe('assertValidReasoningCapability', () => {
  const codeOf = (capability: Parameters<typeof assertValidReasoningCapability>[0]) => {
    try {
      assertValidReasoningCapability(capability);
      return null;
    } catch (err) {
      return (err as ReasoningConfigError).code;
    }
  };

  it('rejects output or streaming while support is unknown', () => {
    expect(codeOf({ supported: null, output: 'summary', streaming: null })).toBe(
      'invalid_reasoning_configuration',
    );
    expect(codeOf({ supported: null, output: null, streaming: true })).toBe(
      'invalid_reasoning_configuration',
    );
  });

  it('rejects a summary on a model that cannot reason', () => {
    expect(codeOf({ supported: false, output: 'summary', streaming: false })).toBe(
      'invalid_reasoning_configuration',
    );
    expect(codeOf({ supported: false, output: null, streaming: true })).toBe(
      'invalid_reasoning_configuration',
    );
  });

  it('rejects streaming without a user-visible summary', () => {
    expect(codeOf({ supported: true, output: 'none', streaming: true })).toBe(
      'invalid_reasoning_configuration',
    );
  });

  it('accepts the valid triples, including an unknown output', () => {
    expect(codeOf({ supported: null, output: null, streaming: null })).toBeNull();
    expect(codeOf({ supported: false, output: 'none', streaming: false })).toBeNull();
    expect(codeOf({ supported: true, output: null, streaming: null })).toBeNull();
    expect(codeOf({ supported: true, output: 'none', streaming: false })).toBeNull();
    expect(codeOf({ supported: true, output: 'summary', streaming: false })).toBeNull();
    expect(codeOf({ supported: true, output: 'summary', streaming: true })).toBeNull();
  });
});

describe('signalsToCapability', () => {
  it('stays unknown when the provider reported nothing reliable', () => {
    const { capability, sources } = signalsToCapability(null);
    expect(capability).toEqual({ supported: null, output: null, streaming: null });
    expect(sources).toEqual({ supported: 'unknown', output: 'unknown', streaming: 'unknown' });
  });

  it('treats an explicit report of "no reasoning" as unsupported', () => {
    const { capability, sources } = signalsToCapability({ reportsReasoning: false });
    expect(capability).toEqual({ supported: false, output: 'none', streaming: false });
    expect(sources.supported).toBe('provider_api');
  });

  it('supports reasoning with an unknown output when only the request capability is known', () => {
    const { capability, sources } = signalsToCapability({ reportsReasoning: true });
    expect(capability).toEqual({ supported: true, output: null, streaming: null });
    expect(sources).toEqual({ supported: 'provider_api', output: 'unknown', streaming: 'unknown' });
  });

  it('keeps output and streaming independent', () => {
    const { capability, sources } = signalsToCapability({
      reportsReasoning: true,
      reportsReasoningSummary: true,
      reportsReasoningStreaming: false,
    });
    expect(capability).toEqual({ supported: true, output: 'summary', streaming: false });
    expect(sources.output).toBe('provider_rules');
    expect(sources.streaming).toBe('provider_rules');
  });

  it('never claims streaming without a user-visible summary', () => {
    const { capability } = signalsToCapability({
      reportsReasoning: true,
      reportsReasoningSummary: undefined,
      reportsReasoningStreaming: true,
    });
    expect(capability.output).toBeNull();
    expect(capability.streaming).toBeNull();
  });

  it('reports no output when the provider documents no summary', () => {
    const { capability } = signalsToCapability({
      reportsReasoning: true,
      reportsReasoningSummary: false,
    });
    expect(capability).toEqual({ supported: true, output: 'none', streaming: false });
  });
});
