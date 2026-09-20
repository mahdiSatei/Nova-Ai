import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { SERPEX_CONTENT_RESULTS } from '../web-search.constants';
import { WebSearchError, WebSearchErrorCode } from '../web-search.errors';
import { WebSearchProvider } from '../web-search-provider.interface';
import {
  WebSearchRawResponse,
  WebSearchRawResult,
  WebSearchRequest,
} from '../web-search.types';

/** Shape of a Serpex search response — the only place these field names appear. */
interface SerpexResult {
  title?: string;
  url?: string;
  snippet?: string;
  position?: number;
  content?: string;
  content_error?: string;
}

interface SerpexBody {
  query?: string;
  results?: SerpexResult[];
  metadata?: {
    status?: string;
    from_cache?: boolean;
  };
}

@Injectable()
export class SerpexProvider implements WebSearchProvider {
  readonly name = 'serpex';
  private readonly logger = new Logger(SerpexProvider.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async search(
    request: WebSearchRequest,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<WebSearchRawResponse> {
    const apiKey = this.config.get('webSearch.serpexApiKey', { infer: true });
    const baseUrl = this.config
      .get('webSearch.serpexApiUrl', { infer: true })
      .replace(/\/+$/, '');

    // ── Diagnostic logging ─────────────────────────────────────────────
    this.logger.debug(
      `[web-search] search() called — query="${request.query}" ` +
        `maxResults=${request.maxResults} includeContent=${request.includeContent} ` +
        `timeoutMs=${options.timeoutMs ?? 'not set'} ` +
        `apiKeySet=${Boolean(apiKey)} apiKeyLength=${apiKey?.length ?? 0} ` +
        `baseUrl="${baseUrl}" signalProvided=${Boolean(options.signal)}`,
    );

    if (!apiKey) {
      this.logger.warn(
        '[web-search] API key is not configured — cannot proceed.',
      );
      throw new WebSearchError(
        'web_search_not_configured',
        'Web search is not configured on this server.',
      );
    }

    this.logger.debug(
      `[web-search] API key present (${apiKey.length} chars), baseUrl="${baseUrl}"`,
    );

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutMs = options.timeoutMs;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            this.logger.warn(
              `[web-search] Request timed out after ${timeoutMs}ms — query="${request.query}"`,
            );
            controller.abort();
          }, timeoutMs)
        : undefined;

    const fetchUrl = `${baseUrl}/api/search`;
    this.logger.debug(
      `[web-search] Sending POST request to ${fetchUrl} (timeout=${timeoutMs ?? 'none'}ms)`,
    );

    const requestStartedAt = Date.now();

    try {
      const res = await fetch(fetchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey.slice(0, 8)}...${apiKey.slice(-4)}`,
        },
        body: JSON.stringify({
          q: request.query,
          include_content: request.includeContent,
          content_results: SERPEX_CONTENT_RESULTS,
        }),
        signal: controller.signal,
      });

      const elapsed = Date.now() - requestStartedAt;
      this.logger.debug(
        `[web-search] Response received — status=${res.status} statusText="${res.statusText}" elapsed=${elapsed}ms`,
      );

      if (!res.ok) {
        this.logger.warn(
          `[web-search] Non-OK response — status=${res.status} statusText="${res.statusText}" elapsed=${elapsed}ms`,
        );
        throw this.mapStatus(res.status);
      }

      let body: SerpexBody;
      try {
        body = (await res.json()) as SerpexBody;
      } catch {
        this.logger.warn(
          `[web-search] Failed to parse JSON response — query="${request.query}"`,
        );
        throw new WebSearchError(
          'web_search_bad_response',
          'Web search returned an invalid response.',
        );
      }

      this.logger.debug(
        `[web-search] Parsed response body — resultsCount=${body.results?.length ?? 'undefined'} ` +
          `query="${body.query ?? ''}" status="${body.metadata?.status ?? 'unset'}" ` +
          `fromCache=${body.metadata?.from_cache ?? false}`,
      );

      if (!Array.isArray(body.results)) {
        this.logger.warn(
          `[web-search] Response does not contain results array — ` +
            `body.results type=${typeof body.results}`,
        );
        throw new WebSearchError(
          'web_search_bad_response',
          'Web search returned an invalid response.',
        );
      }

      const status =
        body.metadata?.status === 'no_results' || body.metadata?.status === 'error'
          ? body.metadata.status
          : 'success';

      return {
        query: body.query ?? request.query,
        results: body.results.map((r) => this.normalizeResult(r)),
        fromCache: Boolean(body.metadata?.from_cache),
        status,
      };
    } catch (err) {
      const elapsed = Date.now() - requestStartedAt;
      if (err instanceof WebSearchError) {
        this.logger.warn(
          `[web-search] WebSearchError — code=${err.code} retryable=${err.retryable} ` +
            `elapsed=${elapsed}ms query="${request.query}"`,
        );
        throw err;
      }
      if (err instanceof Error && err.name === 'AbortError') {
        this.logger.warn(
          `[web-search] Request aborted (AbortError) after ${elapsed}ms — ` +
            `query="${request.query}" signalAborted=${options.signal?.aborted ?? false}`,
        );
        throw new WebSearchError('web_search_timeout', 'Web search timed out.', true);
      }

      // Log the full error for debugging
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : 'Unknown';
      this.logger.error(
        `[web-search] Unexpected error — name="${errName}" message="${errMsg}" ` +
          `elapsed=${elapsed}ms query="${request.query}" baseUrl="${baseUrl}"`,
        err instanceof Error ? err.stack : undefined,
      );
      throw new WebSearchError(
        'web_search_provider_error',
        'Web search provider is unavailable.',
        true,
      );
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private mapStatus(status: number): WebSearchError {
    this.logger.debug(
      `[web-search] mapStatus(${status}) — mapping HTTP status to error code`,
    );
    let code: WebSearchErrorCode = 'web_search_provider_error';
    let retryable = status >= 500;
    if (status === 400) {
      code = 'web_search_bad_response';
      retryable = false;
    } else if (status === 401 || status === 403) {
      code = 'web_search_auth_error';
      retryable = false;
    } else if (status === 402) {
      code = 'web_search_insufficient_credits';
      retryable = false;
    } else if (status === 429) {
      code = 'web_search_rate_limited';
      retryable = true;
    }
    return new WebSearchError(code, `Web search failed (HTTP ${status}).`, retryable);
  }

  private normalizeResult(r: SerpexResult): WebSearchRawResult {
    const out: WebSearchRawResult = {
      title: typeof r.title === 'string' ? r.title : '',
      url: typeof r.url === 'string' ? r.url : '',
      snippet: typeof r.snippet === 'string' ? r.snippet : '',
      position: typeof r.position === 'number' ? r.position : 0,
    };
    if (typeof r.content === 'string' && r.content.length > 0) out.content = r.content;
    if (typeof r.content_error === 'string' && r.content_error.length > 0) {
      out.contentError = r.content_error;
    }
    return out;
  }
}
