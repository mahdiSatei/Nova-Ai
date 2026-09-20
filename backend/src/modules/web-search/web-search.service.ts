import { Inject, Injectable, Logger } from '@nestjs/common';
import { WEB_SEARCH_LIMITS } from './web-search.constants';
import { WebSearchProvider, WEB_SEARCH_PROVIDER } from './web-search-provider.interface';
import { WebSearchOutcome, WebSource } from './web-search.types';

/**
 * Normalizes provider output into application-level sources with stable ids,
 * enforces per-call limits, and truncates retrieved content. It knows nothing
 * about Serpex beyond the injected WebSearchProvider.
 */
@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);

  constructor(
    @Inject(WEB_SEARCH_PROVIDER)
    private readonly provider: WebSearchProvider,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.provider);
  }

  async search(input: {
    query: string;
    /** 1-based id of the first source for this call (stable across the turn). */
    startIndex: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<WebSearchOutcome> {
    const timeoutMs = input.timeoutMs ?? WEB_SEARCH_LIMITS.SEARCH_TIMEOUT_MS;

    this.logger.debug(
      `[web-search] WebSearchService.search() — query="${input.query}" ` +
        `startIndex=${input.startIndex} timeoutMs=${timeoutMs} ` +
        `signalProvided=${Boolean(input.signal)} maxResults=${WEB_SEARCH_LIMITS.MAX_RESULTS_PER_SEARCH}`,
    );

    const searchStartedAt = Date.now();

    const raw = await this.provider.search(
      {
        query: input.query,
        maxResults: WEB_SEARCH_LIMITS.MAX_RESULTS_PER_SEARCH,
        includeContent: true,
      },
      {
        signal: input.signal,
        timeoutMs,
      },
    );

    const searchElapsed = Date.now() - searchStartedAt;

    this.logger.debug(
      `[web-search] Provider search completed — ` +
        `elapsed=${searchElapsed}ms rawResults=${raw.results.length} ` +
        `fromCache=${raw.fromCache ?? false} status="${raw.status}"`,
    );

    const sources: WebSource[] = [];
    for (const result of raw.results) {
      if (!result.url) continue;
      const source: WebSource = {
        id: `S${input.startIndex + sources.length}`,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        provider: this.provider.name,
      };
      if (result.content) {
        const truncated = result.content.length > WEB_SEARCH_LIMITS.MAX_CONTENT_CHARS_PER_SOURCE;
        source.content = truncated
          ? result.content.slice(0, WEB_SEARCH_LIMITS.MAX_CONTENT_CHARS_PER_SOURCE)
          : result.content;
        if (truncated) source.contentTruncated = true;
      }
      sources.push(source);
    }

    return {
      query: raw.query,
      sources,
      empty: sources.length === 0,
    };
  }
}
