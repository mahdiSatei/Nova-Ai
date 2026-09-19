import { ReasoningStreamNormalizer, REASONING_LIMITS } from '../../src/modules/chat/reasoning-stream';

describe('ReasoningStreamNormalizer', () => {
  it('emits nothing at all when reasoning was not requested', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: false });
    expect(normalizer.pushReasoning('secret thinking')).toEqual([]);
    expect(normalizer.onAnswerContent()).toEqual([]);
    expect(normalizer.finish()).toEqual([]);
    expect(normalizer.sawReasoning).toBe(false);
    expect(normalizer.userVisibleSummary).toBeNull();
  });

  it('never fabricates reasoning events when the provider exposes none', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    expect(normalizer.pushReasoning(undefined)).toEqual([]);
    expect(normalizer.pushReasoning(null)).toEqual([]);
    expect(normalizer.pushReasoning('')).toEqual([]);
    expect(normalizer.sawReasoning).toBe(false);
  });

  it('emits started once, then plain deltas', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    expect(normalizer.pushReasoning('first ')).toEqual([
      { kind: 'started' },
      { kind: 'delta', delta: 'first ' },
    ]);
    expect(normalizer.pushReasoning('second')).toEqual([{ kind: 'delta', delta: 'second' }]);
    expect(normalizer.summary).toBe('first second');
    expect(normalizer.sawReasoning).toBe(true);
  });

  it('completes exactly once when the answer starts', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    normalizer.pushReasoning('thinking');
    expect(normalizer.onAnswerContent()).toEqual([{ kind: 'completed' }]);
    expect(normalizer.onAnswerContent()).toEqual([]);
    expect(normalizer.finish()).toEqual([]);
  });

  it('completes an unfinished reasoning block once when the stream ends', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    normalizer.pushReasoning('thinking');
    expect(normalizer.finish()).toEqual([{ kind: 'completed' }]);
    expect(normalizer.finish()).toEqual([]);
  });

  it('does not complete when reasoning never started', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    expect(normalizer.finish()).toEqual([]);
    expect(normalizer.onAnswerContent()).toEqual([]);
  });

  it('keeps streaming deltas after completion and keeps the summary growing', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    normalizer.pushReasoning('a');
    expect(normalizer.onAnswerContent()).toEqual([{ kind: 'completed' }]);
    expect(normalizer.pushReasoning('b')).toEqual([{ kind: 'delta', delta: 'b' }]);
    expect(normalizer.summary).toBe('ab');
  });

  it('caps the summary and stops emitting past the limit', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    const oversized = 'x'.repeat(REASONING_LIMITS.MAX_SUMMARY_CHARS + 500);

    normalizer.pushReasoning(oversized);

    expect(normalizer.summary).toHaveLength(REASONING_LIMITS.MAX_SUMMARY_CHARS);
    expect(normalizer.pushReasoning('more')).toEqual([]);
  });

  it('reports no user-visible summary for whitespace-only reasoning', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    normalizer.pushReasoning('   \n ');
    expect(normalizer.sawReasoning).toBe(true);
    expect(normalizer.userVisibleSummary).toBeNull();
  });

  it('trims the persisted summary', () => {
    const normalizer = new ReasoningStreamNormalizer({ enabled: true });
    normalizer.pushReasoning('  a considered answer  ');
    expect(normalizer.userVisibleSummary).toBe('a considered answer');
  });
});
