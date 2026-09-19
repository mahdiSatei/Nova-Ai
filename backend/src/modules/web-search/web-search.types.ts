/** Provider-independent web-search DTOs. No Serpex types may leak past the adapter. */

export interface WebSearchRequest {
  query: string;
  maxResults: number;
  includeContent: boolean;
}

export interface WebSearchRawResult {
  title: string;
  url: string;
  snippet: string;
  position: number;
  content?: string;
  contentError?: string;
}

export interface WebSearchRawResponse {
  query: string;
  results: WebSearchRawResult[];
  creditsUsed: number;
  fromCache: boolean;
  status: 'success' | 'no_results' | 'error';
}

/** A normalized, application-level source with a stable id (S1, S2, …). */
export interface WebSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  provider: string;
  content?: string;
  contentTruncated?: boolean;
}

/** What the frontend receives and what is persisted on the assistant message. */
export interface CitationSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOutcome {
  query: string;
  sources: WebSource[];
  creditsUsed: number;
  empty: boolean;
}
