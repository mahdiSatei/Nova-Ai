import { buildCitations, extractCitationIds } from '../../src/modules/chat/citations';
import type { WebSource } from '../../src/modules/web-search/web-search.types';

const src = (id: string, url: string): WebSource => ({
  id,
  title: `T ${id}`,
  url,
  snippet: 's',
  provider: 'fake',
});

describe('extractCitationIds', () => {
  it('finds unique [S#] markers in first-seen order', () => {
    expect(extractCitationIds('A [S2] and [S1] and again [S2].')).toEqual(['S2', 'S1']);
  });

  it('returns nothing when there are no markers', () => {
    expect(extractCitationIds('plain answer')).toEqual([]);
  });
});

describe('buildCitations', () => {
  it('maps cited ids to sources, ignoring unknown ids', () => {
    const out = buildCitations([src('S1', 'https://a'), src('S2', 'https://b')], ['S2', 'S9']);
    expect(out).toEqual([{ id: 'S2', title: 'T S2', url: 'https://b', snippet: 's' }]);
  });

  it('falls back to every retrieved source when the model cites nothing', () => {
    const out = buildCitations([src('S1', 'https://a'), src('S2', 'https://b')], []);
    expect(out.map((c) => c.id)).toEqual(['S1', 'S2']);
  });
});
