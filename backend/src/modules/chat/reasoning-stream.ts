/** Bounded reasoning summary for one assistant turn. */
export const REASONING_LIMITS = {
  MAX_SUMMARY_CHARS: 20_000,
} as const;

export type ReasoningStreamEvent =
  | { kind: 'started' }
  | { kind: 'delta'; delta: string }
  | { kind: 'completed' };

/**
 * Normalizes provider reasoning chunks into the application's reasoning event
 * lifecycle (Phase 8, spec §Streaming).
 *
 * The normalizer only ever sees the summary the provider exposes to users —
 * private chain-of-thought never reaches this class, and nothing is synthesized
 * when the provider sends no reasoning field. It therefore emits no events at
 * all for a model that reasons internally without exposing output.
 */
export class ReasoningStreamNormalizer {
  private buffer = '';
  private started = false;
  private completed = false;
  private truncated = false;

  constructor(private readonly options: { enabled: boolean }) {}

  /** Feed one provider reasoning delta. Returns the events to broadcast, in order. */
  pushReasoning(chunk?: string | null): ReasoningStreamEvent[] {
    if (!this.options.enabled || this.truncated) return [];
    if (typeof chunk !== 'string' || chunk.length === 0) return [];

    const room = REASONING_LIMITS.MAX_SUMMARY_CHARS - this.buffer.length;
    if (room <= 0) {
      this.truncated = true;
      return [];
    }

    const accepted = chunk.length <= room ? chunk : chunk.slice(0, room);
    this.buffer += accepted;
    if (accepted.length < chunk.length) this.truncated = true;

    if (this.started) return [{ kind: 'delta', delta: accepted }];

    this.started = true;
    return [{ kind: 'started' }, { kind: 'delta', delta: accepted }];
  }

  /** The model started producing answer text: reasoning is over. */
  onAnswerContent(): ReasoningStreamEvent[] {
    return this.complete();
  }

  /** The generation ended while reasoning was still open. */
  finish(): ReasoningStreamEvent[] {
    return this.complete();
  }

  get summary(): string {
    return this.buffer;
  }

  get sawReasoning(): boolean {
    return this.started;
  }

  /** The only value that may be persisted or displayed. `null` when there is none. */
  get userVisibleSummary(): string | null {
    const trimmed = this.buffer.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private complete(): ReasoningStreamEvent[] {
    if (!this.options.enabled || !this.started || this.completed) return [];
    this.completed = true;
    return [{ kind: 'completed' }];
  }
}
