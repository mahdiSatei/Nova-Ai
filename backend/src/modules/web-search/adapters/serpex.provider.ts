import { Injectable } from '@nestjs/common';
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
    credits_used?: number;
    from_cache?: boolean;
  };
}

@Injectable()
export class SerpexProvider implements WebSearchProvider {
  readonly name = 'serpex';

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  async search(
    request: WebSearchRequest,
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<WebSearchRawResponse> {
    const apiKey = this.config.get('webSearch.serpexApiKey', { infer: true });
    if (!apiKey) {
      throw new WebSearchError(
        'web_search_not_configured',
        'Web search is not configured on this server.',
      );
    }
    const baseUrl = this.config
      .get('webSearch.serpexApiUrl', { infer: true })
      .replace(/\/+$/, '');

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timeoutMs = options.timeoutMs;
    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;

    try {
      const res = await fetch(`${baseUrl}/api/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          q: request.query,
          include_content: request.includeContent,
          content_results: SERPEX_CONTENT_RESULTS,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw this.mapStatus(res.status);
      }

      let body: SerpexBody;
      try {
        body = (await res.json()) as SerpexBody;
      } catch {
        throw new WebSearchError(
          'web_search_bad_response',
          'Web search returned an invalid response.',
        );
      }
      if (!Array.isArray(body.results)) {
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
        creditsUsed: Number(body.metadata?.credits_used ?? 0) || 0,
        fromCache: Boolean(body.metadata?.from_cache),
        status,
      };
    } catch (err) {
      if (err instanceof WebSearchError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebSearchError('web_search_timeout', 'Web search timed out.', true);
      }
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
