import { Provider } from '../entities/provider.entity';

export interface ProviderChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProviderStreamChunk {
  choices?: Array<{
    delta?: { content?: string };
  }>;
}

/**
 * Abstraction over any AI provider. The chat service invokes models
 * through this interface — never through provider-specific logic.
 *
 * Adding a new provider means implementing this interface and registering
 * the adapter; the chat orchestration layer does not change.
 */
export interface ProviderAdapter {
  /** Validate credentials against the provider. Throws NormalizedProviderError on failure. */
  validate(provider: Provider): Promise<void>;

  /** Start a streaming chat completion. Returns an async iterable of chunks. */
  stream(
    provider: Provider,
    params: {
      model: string;
      messages: ProviderChatMessage[];
    },
  ): Promise<AsyncIterable<ProviderStreamChunk>>;
}
