/** Bounded limits for a single assistant turn (spec §Reliability and Limits). */
export const WEB_SEARCH_LIMITS = {
  MAX_SEARCHES_PER_TURN: 3,
  MAX_RESULTS_PER_SEARCH: 5,
  MAX_SOURCES_PER_TURN: 10,
  MAX_CONTENT_CHARS_PER_SOURCE: 4000,
  // Serpex with include_content routinely takes 5-8s and can exceed 8s,
  // so the per-search timeout leaves margin above its observed latency.
  MAX_TOTAL_SEARCH_MS: 25_000,
  SEARCH_TIMEOUT_MS: 12_000,
} as const;

/** Serpex accepts only 5 or 10 for `content_results`. */
export const SERPEX_CONTENT_RESULTS = 5;
