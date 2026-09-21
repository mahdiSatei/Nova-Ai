export type WebSearchErrorCode =
  | 'web_search_not_configured'
  | 'web_search_auth_error'
  | 'web_search_rate_limited'
  | 'web_search_insufficient_credits'
  | 'web_search_timeout'
  | 'web_search_provider_error'
  | 'web_search_bad_response';

export class WebSearchError extends Error {
  constructor(
    public readonly code: WebSearchErrorCode,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = 'WebSearchError';
  }
}
