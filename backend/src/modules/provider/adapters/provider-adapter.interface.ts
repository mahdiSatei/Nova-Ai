import { Provider } from '../entities/provider.entity';

export interface ProviderToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ProviderToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ProviderChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  /** Present on an assistant message that requested tools. */
  toolCalls?: ProviderToolCall[];
  /** Present on a `tool` result message; links it to the request. */
  toolCallId?: string;
}

export interface ProviderStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  /** Present in the final chunk when the provider supplies usage data. */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
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
      tools?: ProviderToolDefinition[];
    },
  ): Promise<AsyncIterable<ProviderStreamChunk>>;
}
