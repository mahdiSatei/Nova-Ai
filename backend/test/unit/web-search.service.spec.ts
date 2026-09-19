import { WebSearchService } from '../../src/modules/web-search/web-search.service';
import { WebSearchError } from '../../src/modules/web-search/web-search.errors';
import type { WebSearchProvider } from '../../src/modules/web-search/web-search-provider.interface';

function build(provider: Partial<WebSearchProvider>) {
  return new WebSearchService({ name: 'fake', search: jest.fn(), ...provider } as never);
}

const raw = (over: Record<string, unknown> = {}) => ({
  query: 'q',
  creditsUsed: 1,
  fromCache: false,
  status: 'success' as const,
  results: [
    { title: 'A', url: 'https://a.test', snippet: 'sa', position: 1, content: 'x'.repeat(10) },
    { title: 'B', url: 'https://b.test', snippet: 'sb', position: 2, contentError: 'blocked' },
    { title: 'C', url: '', snippet: 'sc', position: 3 },
  ],
  ...over,
});

describe('WebSearchService', () => {
  it('assigns stable ids from startIndex and drops results without a URL', async () => {
    const svc = build({ search: jest.fn().mockResolvedValue(raw()) });
    const out = await svc.search({ query: 'q', startIndex: 1 });
    expect(out.sources.map((s) => s.id)).toEqual(['S1', 'S2']);
    expect(out.sources[1]).toMatchObject({ id: 'S2', url: 'https://b.test', provider: 'fake' });
    expect(out.sources[1].content).toBeUndefined();
    expect(out.empty).toBe(false);
    expect(out.creditsUsed).toBe(1);
  });

  it('continues ids after earlier searches', async () => {
    const svc = build({ search: jest.fn().mockResolvedValue(raw()) });
    const out = await svc.search({ query: 'q', startIndex: 3 });
    expect(out.sources.map((s) => s.id)).toEqual(['S3', 'S4']);
  });

  it('truncates oversized content and flags it', async () => {
    const svc = build({
      search: jest.fn().mockResolvedValue(
        raw({
          results: [
            { title: 'A', url: 'https://a.test', snippet: 's', position: 1, content: 'y'.repeat(9999) },
          ],
        }),
      ),
    });
    const out = await svc.search({ query: 'q', startIndex: 1 });
    expect(out.sources[0].content).toHaveLength(4000);
    expect(out.sources[0].contentTruncated).toBe(true);
  });

  it('reports empty when the provider returns no results', async () => {
    const svc = build({
      search: jest.fn().mockResolvedValue(raw({ results: [], status: 'no_results' })),
    });
    const out = await svc.search({ query: 'q', startIndex: 1 });
    expect(out.empty).toBe(true);
    expect(out.sources).toEqual([]);
  });

  it('propagates WebSearchError unchanged', async () => {
    const err = new WebSearchError('web_search_rate_limited', 'slow', true);
    const svc = build({ search: jest.fn().mockRejectedValue(err) });
    await expect(svc.search({ query: 'q', startIndex: 1 })).rejects.toBe(err);
  });

  it('reports isConfigured from the provider presence', () => {
    const svc = build({});
    expect(svc.isConfigured()).toBe(true);
  });
});
