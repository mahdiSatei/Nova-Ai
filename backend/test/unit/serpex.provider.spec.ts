import { SerpexProvider } from '../../src/modules/web-search/adapters/serpex.provider';
import { WebSearchError } from '../../src/modules/web-search/web-search.errors';
import { SERPEX_CONTENT_RESULTS } from '../../src/modules/web-search/web-search.constants';

function build(overrides: { apiKey?: string; apiUrl?: string } = {}) {
  const config = {
    get: jest.fn((key: string) => {
      if (key === 'webSearch.serpexApiKey') return overrides.apiKey ?? 'sk_test';
      if (key === 'webSearch.serpexApiUrl') return overrides.apiUrl ?? 'https://api.serpex.dev';
      return undefined;
    }),
  };
  return new SerpexProvider(config as never);
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const OK_BODY = {
  query: 'q',
  results: [
    { title: 'T1', url: 'https://a.test/1', snippet: 's1', position: 1, content: '# one' },
    { title: 'T2', url: 'https://b.test/2', snippet: 's2', position: 2, content_error: 'blocked' },
  ],
  metadata: { status: 'success', credits_used: 2, from_cache: false },
};

describe('SerpexProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('posts an authenticated request and normalizes the response', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, OK_BODY));
    const provider = build();

    const res = await provider.search({ query: 'hello', maxResults: 5, includeContent: true });

    expect(provider.name).toBe('serpex');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.serpex.dev/api/search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test' }),
        body: JSON.stringify({ q: 'hello', include_content: true, content_results: SERPEX_CONTENT_RESULTS }),
      }),
    );
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toMatchObject({ title: 'T1', url: 'https://a.test/1', content: '# one' });
    expect(res.results[1]).toMatchObject({ contentError: 'blocked' });
    expect(res.creditsUsed).toBe(2);
    expect(res.status).toBe('success');
  });

  it('maps no_results with credits from metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { query: 'q', results: [], metadata: { status: 'no_results', credits_used: 1 } }),
    );
    const res = await build().search({ query: 'q', maxResults: 5, includeContent: true });
    expect(res.results).toEqual([]);
    expect(res.status).toBe('no_results');
    expect(res.creditsUsed).toBe(1);
  });

  it.each([
    [401, 'web_search_auth_error'],
    [402, 'web_search_insufficient_credits'],
    [429, 'web_search_rate_limited'],
    [400, 'web_search_bad_response'],
    [503, 'web_search_provider_error'],
  ])('maps HTTP %i to %s', async (status, code) => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(status, { error: 'nope' }));
    await expect(
      build().search({ query: 'q', maxResults: 5, includeContent: true }),
    ).rejects.toMatchObject({ code });
  });

  it('maps a network failure to web_search_provider_error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      build().search({ query: 'q', maxResults: 5, includeContent: true }),
    ).rejects.toBeInstanceOf(WebSearchError);
  });

  it('maps a malformed body to web_search_bad_response', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { nope: true }));
    await expect(
      build().search({ query: 'q', maxResults: 5, includeContent: true }),
    ).rejects.toMatchObject({ code: 'web_search_bad_response' });
  });

  it('fails fast with web_search_not_configured when the key is empty', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    await expect(
      build({ apiKey: '' }).search({ query: 'q', maxResults: 5, includeContent: true }),
    ).rejects.toMatchObject({ code: 'web_search_not_configured' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
