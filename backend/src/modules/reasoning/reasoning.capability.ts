import { ReasoningConfigError } from './reasoning.errors';
import {
  CapabilitySource,
  EMPTY_REASONING_CONFIG,
  ProviderReasoningSignals,
  ReasoningCapability,
  ReasoningCapabilitySources,
  ReasoningConfigMode,
  ReasoningOutput,
  ResolvedReasoningConfig,
  StoredReasoningConfig,
  UNKNOWN_REASONING_CAPABILITY,
  UNKNOWN_REASONING_SOURCES,
} from './reasoning.types';

const MODES: ReasoningConfigMode[] = ['automatic', 'manual'];
const OUTPUTS: ReasoningOutput[] = ['none', 'summary'];
const SOURCES: CapabilitySource[] = ['provider_api', 'provider_rules', 'manual', 'unknown'];

/** Coerce a stored JSONB snapshot into the normalized shape, tolerating garbage. */
export function readStoredReasoningConfig(raw: unknown): StoredReasoningConfig {
  const source = (raw ?? {}) as Record<string, unknown>;
  const discovered = (source.discovered ?? {}) as Record<string, unknown>;
  const manual = (source.manual ?? {}) as Record<string, unknown>;
  const sources = (discovered.sources ?? {}) as Record<string, unknown>;

  return {
    mode: MODES.includes(source.mode as ReasoningConfigMode)
      ? (source.mode as ReasoningConfigMode)
      : EMPTY_REASONING_CONFIG.mode,
    discovered: {
      supported: booleanOrNull(discovered.supported),
      output: outputOrNull(discovered.output),
      streaming: booleanOrNull(discovered.streaming),
      sources: {
        supported: sourceOrUnknown(sources.supported),
        output: sourceOrUnknown(sources.output),
        streaming: sourceOrUnknown(sources.streaming),
      },
      discoveredAt: typeof discovered.discoveredAt === 'string' ? discovered.discoveredAt : null,
    },
    manual: {
      supported: booleanOrNull(manual.supported),
      output: outputOrNull(manual.output),
      streaming: booleanOrNull(manual.streaming),
    },
  };
}

/**
 * The effective configuration. Deterministic for any stored value: contradictions
 * are collapsed rather than rejected so a bad row can never crash a chat request.
 */
export function resolveReasoningConfig(config: StoredReasoningConfig): ResolvedReasoningConfig {
  const chosen = config.mode === 'manual' ? config.manual : config.discovered;

  const supported = chosen.supported ?? null;
  const output: ReasoningOutput | null = supported === false ? 'none' : chosen.output ?? null;
  let streaming: boolean | null = supported === false ? false : chosen.streaming ?? null;

  // A model that cannot reason exposes no output; reasoning can only be streamed
  // when a user-visible summary exists.
  if (streaming === true && output !== 'summary') streaming = false;

  return { supported, output, streaming, configurationSource: config.mode };
}

/**
 * Narrow the resolved configuration for end users. Unknown capabilities become
 * "unsupported with no output" so the frontend can never offer a dead control.
 */
export function toPublicReasoning(resolved: ResolvedReasoningConfig): {
  supported: boolean;
  output: 'none' | 'summary';
  streaming: boolean;
} {
  return {
    supported: resolved.supported === true,
    output: resolved.output === 'summary' ? 'summary' : 'none',
    streaming: resolved.streaming === true,
  };
}

const INVALID = 'invalid_reasoning_configuration';

/** Guard every write so a contradictory configuration can never be stored. */
export function assertValidReasoningCapability(capability: ReasoningCapability): void {
  const { supported, output, streaming } = capability;

  if (supported === null && (output !== null || streaming !== null)) {
    throw new ReasoningConfigError(
      INVALID,
      'Reasoning output and streaming need an explicit "supported" value.',
    );
  }
  if (supported === false && output === 'summary') {
    throw new ReasoningConfigError(
      INVALID,
      'A model that does not support reasoning cannot expose a summary.',
    );
  }
  if (supported === false && streaming === true) {
    throw new ReasoningConfigError(
      INVALID,
      'A model that does not support reasoning cannot stream reasoning.',
    );
  }
  if (streaming === true && output !== 'summary') {
    throw new ReasoningConfigError(
      INVALID,
      'Reasoning streaming requires a user-visible summary output.',
    );
  }
}

/**
 * Map normalized provider metadata signals onto a capability triple. Used only
 * by discovery — manual configuration bypasses it.
 */
export function signalsToCapability(signals: ProviderReasoningSignals | null): {
  capability: ReasoningCapability;
  sources: ReasoningCapabilitySources;
} {
  if (!signals || signals.reportsReasoning === undefined) {
    return {
      capability: { ...UNKNOWN_REASONING_CAPABILITY },
      sources: { ...UNKNOWN_REASONING_SOURCES },
    };
  }

  if (signals.reportsReasoning === false) {
    return {
      capability: { supported: false, output: 'none', streaming: false },
      sources: { supported: 'provider_api', output: 'provider_api', streaming: 'provider_api' },
    };
  }

  const knownSummary = signals.reportsReasoningSummary !== undefined;
  const output: ReasoningOutput | null = !knownSummary
    ? null
    : signals.reportsReasoningSummary
      ? 'summary'
      : 'none';

  let streaming: boolean | null = null;
  if (output === 'summary' && signals.reportsReasoningStreaming !== undefined) {
    streaming = signals.reportsReasoningStreaming;
  } else if (output === 'none') {
    streaming = false;
  }

  return {
    capability: { supported: true, output, streaming },
    sources: {
      supported: 'provider_api',
      output: knownSummary ? 'provider_rules' : 'unknown',
      streaming: output === 'none' || streaming !== null ? 'provider_rules' : 'unknown',
    },
  };
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function outputOrNull(value: unknown): ReasoningOutput | null {
  return OUTPUTS.includes(value as ReasoningOutput) ? (value as ReasoningOutput) : null;
}

function sourceOrUnknown(value: unknown): CapabilitySource {
  return SOURCES.includes(value as CapabilitySource) ? (value as CapabilitySource) : 'unknown';
}
