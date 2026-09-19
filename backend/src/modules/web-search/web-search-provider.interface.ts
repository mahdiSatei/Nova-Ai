import { WebSearchRawResponse, WebSearchRequest } from './web-search.types';

export const WEB_SEARCH_PROVIDER = Symbol('WEB_SEARCH_PROVIDER');

/**
 * Provider-independent search contract. Adding a provider means adding an
 * adapter that implements this interface — core chat logic never changes.
 */
export interface WebSearchProvider {
  readonly name: string;
  search(
    request: WebSearchRequest,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<WebSearchRawResponse>;
}
