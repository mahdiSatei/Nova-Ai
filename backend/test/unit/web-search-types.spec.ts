import { WEB_SEARCH_LIMITS, SERPEX_CONTENT_RESULTS } from '../../src/modules/web-search/web-search.constants';
import { WebSearchError } from '../../src/modules/web-search/web-search.errors';
import { WEB_SEARCH_PROVIDER } from '../../src/modules/web-search/web-search-provider.interface';

describe('Web search domain', () => {
  it('publishes bounded limits', () => {
    expect(WEB_SEARCH_LIMITS.MAX_SEARCHES_PER_TURN).toBe(3);
    expect(WEB_SEARCH_LIMITS.MAX_RESULTS_PER_SEARCH).toBe(5);
    expect(WEB_SEARCH_LIMITS.MAX_SOURCES_PER_TURN).toBe(10);
    expect(WEB_SEARCH_LIMITS.MAX_CONTENT_CHARS_PER_SOURCE).toBe(4000);
    expect(WEB_SEARCH_LIMITS.MAX_TOTAL_SEARCH_MS).toBe(15000);
    expect(WEB_SEARCH_LIMITS.SEARCH_TIMEOUT_MS).toBe(8000);
    // Serpex only accepts content_results of exactly 5 or 10.
    expect(SERPEX_CONTENT_RESULTS).toBe(5);
  });

  it('carries a stable code and retryability on WebSearchError', () => {
    const err = new WebSearchError('web_search_rate_limited', 'slow down', true);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('web_search_rate_limited');
    expect(err.retryable).toBe(true);
    expect(err.name).toBe('WebSearchError');
  });

  it('exports a unique injection token', () => {
    expect(typeof WEB_SEARCH_PROVIDER).toBe('symbol');
  });
});
