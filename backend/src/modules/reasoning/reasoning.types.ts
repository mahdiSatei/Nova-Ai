/**
 * Provider-independent reasoning capability model (Phase 8, spec §Core Concepts).
 *
 * `null` always means "unknown" — never a guess. Provider-specific capability
 * names, parameters and response fields must not appear in this module.
 */

/**
 * Normalized capability signals a provider explicitly reported for a model.
 * Every field is `undefined` when the provider said nothing — which must stay
 * "unknown", never a guess. Provider-specific field names never leave the adapter.
 */
export interface ProviderReasoningSignals {
  /** The provider explicitly states whether this model accepts a reasoning request. */
  reportsReasoning?: boolean;
  /** The provider documents a user-visible reasoning summary for this model. */
  reportsReasoningSummary?: boolean;
  /** The provider streams that summary incrementally. */
  reportsReasoningStreaming?: boolean;
}

export type ReasoningConfigMode = 'automatic' | 'manual';
export type ReasoningOutput = 'none' | 'summary';

/** Where a capability value came from. */
export type CapabilitySource = 'provider_api' | 'provider_rules' | 'manual' | 'unknown';

/** `null` = unknown. */
export interface ReasoningCapability {
  supported: boolean | null;
  output: ReasoningOutput | null;
  streaming: boolean | null;
}

export interface ReasoningCapabilitySources {
  supported: CapabilitySource;
  output: CapabilitySource;
  streaming: CapabilitySource;
}

/** Persisted on `models.reasoning_config` (JSONB). Discovery never overwrites manual values. */
export interface StoredReasoningConfig {
  mode: ReasoningConfigMode;
  discovered: ReasoningCapability & {
    sources: ReasoningCapabilitySources;
    discoveredAt: string | null;
  };
  manual: ReasoningCapability;
}

/** The effective configuration the application runs on (spec §Model Capability Model). */
export interface ResolvedReasoningConfig {
  supported: boolean | null;
  output: ReasoningOutput | null;
  streaming: boolean | null;
  configurationSource: ReasoningConfigMode;
}

/** Admin-supplied patch. `null` explicitly sets a capability back to unknown. */
export interface ReasoningConfigInput {
  mode?: ReasoningConfigMode;
  supported?: boolean | null;
  output?: ReasoningOutput | null;
  streaming?: boolean | null;
}

export const UNKNOWN_REASONING_SOURCES: ReasoningCapabilitySources = {
  supported: 'unknown',
  output: 'unknown',
  streaming: 'unknown',
};

export const UNKNOWN_REASONING_CAPABILITY: ReasoningCapability = {
  supported: null,
  output: null,
  streaming: null,
};

export const EMPTY_REASONING_CONFIG: StoredReasoningConfig = {
  mode: 'automatic',
  discovered: {
    ...UNKNOWN_REASONING_CAPABILITY,
    sources: { ...UNKNOWN_REASONING_SOURCES },
    discoveredAt: null,
  },
  manual: { ...UNKNOWN_REASONING_CAPABILITY },
};
