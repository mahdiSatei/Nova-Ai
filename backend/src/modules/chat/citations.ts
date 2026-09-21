import type { CitationSource, WebSource } from '../web-search/web-search.types';

const MARKER = /\[S(\d+)\]/g;

/** Unique source ids referenced by the model, in first-seen order. */
export function extractCitationIds(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(MARKER)) {
    const id = `S${match[1]}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Citations always come from retrieved sources — never from model text. When the
 * model cited nothing we still return the retrieved sources so the answer is
 * transparent.
 */
export function buildCitations(sources: WebSource[], citedIds: string[]): CitationSource[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  const ids = citedIds.length > 0 ? citedIds : sources.map((s) => s.id);
  const seen = new Set<string>();
  const out: CitationSource[] = [];
  for (const id of ids) {
    const source = byId.get(id);
    if (!source || seen.has(id)) continue;
    seen.add(id);
    out.push({ id: source.id, title: source.title, url: source.url, snippet: source.snippet });
  }
  return out;
}
