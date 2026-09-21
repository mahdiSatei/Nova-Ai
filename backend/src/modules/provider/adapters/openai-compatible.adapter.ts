import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { decrypt } from '../../../common/crypto/credential-cipher';
import { Provider, ProviderType } from '../entities/provider.entity';
import {
  ProviderAdapter,
  ProviderChatMessage,
  ProviderReasoningRequest,
  ProviderStreamChunk,
  ProviderToolDefinition,
} from './provider-adapter.interface';
import { NormalizedProviderError } from '../errors/normalized-provider.error';
import { normalizeStreamError } from '../failure-classification';
import { PROVIDER_TIMEOUTS } from '../constants/provider-timeouts';
import type { ProviderReasoningSignals } from '../../reasoning/reasoning.types';

/**
 * Provider-specific capability rules. A provider name only appears here when its
 * documented metadata is unambiguous; any provider absent from this table keeps
 * its models at "unknown" rather than being guessed from the model name.
 */
const REASONING_PARAMETER_NAMES = [
  'reasoning',
  'include_reasoning',
  'reasoning_effort',
  'reasoning_content',
];

/** OpenRouter documents a streamed, user-visible reasoning summary. */
function exposesReasoningSummary(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith('openrouter.ai');
  } catch {
    return false;
  }
}

@Injectable()
export class OpenAICompatibleAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenAICompatibleAdapter.name);

  supports(type: ProviderType): boolean {
    // Existing deployments persisted this adapter under the custom alias.
    return type === 'openai-compatible' || type === 'custom-openai-compatible';
  }

  async validate(provider: Provider): Promise<void> {
    const apiKey = decrypt(provider.apiKeyEncrypted);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new NormalizedProviderError({
          code: 'provider_timeout',
          message: 'Provider validation timed out.',
          statusCode: 504,
          originalMessage: 'Validation deadline exceeded',
        }));
        controller.abort();
      }, PROVIDER_TIMEOUTS.VALIDATION_MS);
    });

    try {
      const res = await Promise.race([fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      }), deadline]);
      if (res.ok) return;

      const status = res.status;
      if (status === 401 || status === 403) {
        throw new NormalizedProviderError({
          code: 'credentials_rejected',
          message: 'Provider rejected credentials.',
          statusCode: 422,
          originalMessage: `HTTP ${status}`,
        });
      }
      if (status === 404 || status === 405) {
        throw new NormalizedProviderError({
          code: 'provider_type_unsupported',
          message: 'Provider does not support GET /models or the endpoint is unavailable.',
          statusCode: 422,
          originalMessage: `HTTP ${status}`,
        });
      }
      if (status >= 500 && status < 600) {
        throw new NormalizedProviderError({
          code: status === 503 ? 'provider_rate_limited' : 'provider_unreachable',
          message: 'Upstream provider error.',
          statusCode: status === 503 ? 503 : 502,
          originalMessage: `HTTP ${status}`,
        });
      }
      throw new NormalizedProviderError({
        code: 'provider_unreachable',
        message: 'Provider returned unexpected status.',
        statusCode: 422,
        originalMessage: `HTTP ${status}`,
      });
    } catch (err) {
      if (err instanceof NormalizedProviderError) throw err;
      throw new NormalizedProviderError({
        code: 'provider_unreachable',
        message: 'Provider could not be reached.',
        statusCode: 422,
        originalMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async discoverCapabilities(
    provider: Provider,
    modelName: string,
  ): Promise<ProviderReasoningSignals | null> {
    const apiKey = decrypt(provider.apiKeyEncrypted);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUTS.VALIDATION_MS);

    try {
      const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) return null;

      const body = (await res.json()) as { data?: unknown };
      if (!Array.isArray(body.data)) return null;

      const entry = body.data.find(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && (item as { id?: unknown }).id === modelName,
      );
      if (!entry) return null;

      const supportedParameters = Array.isArray(entry.supported_parameters)
        ? entry.supported_parameters.filter((value): value is string => typeof value === 'string')
        : [];
      const explicitBoolean =
        typeof entry.supports_reasoning === 'boolean' ? entry.supports_reasoning : undefined;

      let reportsReasoning: boolean;
      if (explicitBoolean !== undefined) {
        reportsReasoning = explicitBoolean;
      } else if (supportedParameters.length > 0) {
        reportsReasoning = supportedParameters.some((name) =>
          REASONING_PARAMETER_NAMES.includes(name.toLowerCase()),
        );
      } else {
        // The provider told us nothing we can rely on.
        return null;
      }

      const signals: ProviderReasoningSignals = { reportsReasoning };
      if (reportsReasoning && exposesReasoningSummary(provider.baseUrl)) {
        signals.reportsReasoningSummary = true;
        signals.reportsReasoningStreaming = true;
      }
      return signals;
    } catch (err) {
      this.logger.debug(
        `Capability discovery failed for model=${modelName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Translate the normalized reasoning request into provider-specific parameters.
   * This is the only place provider reasoning parameter names may appear.
   *
   *  - OpenRouter: documented `reasoning.effort`, plus `include_reasoning` when a
   *    user-visible summary is wanted.
   *  - Other OpenAI-compatible providers: the documented high effort knob.
   */
  private buildReasoningParams(
    provider: Provider,
    reasoning?: ProviderReasoningRequest,
  ): Record<string, unknown> {
    if (!reasoning?.enabled) return {};

    if (exposesReasoningSummary(provider.baseUrl)) {
      return {
        reasoning: { effort: 'high' },
        ...(reasoning.summary ? { include_reasoning: true } : {}),
      };
    }

    return { reasoning_effort: 'high' };
  }

  /**
   * Normalize provider reasoning response fields onto `delta.reasoning` so only
   * one shape reaches the chat service. Provider-specific field names are removed.
   */
  private async *normalizeReasoningDeltas(
    stream: AsyncIterable<unknown>,
  ): AsyncIterable<ProviderStreamChunk> {
    for await (const raw of stream) {
      const chunk = raw as ProviderStreamChunk & {
        choices?: Array<{ delta?: Record<string, unknown> }>;
      };
      const delta = chunk.choices?.[0]?.delta;

      if (delta) {
        if (typeof delta.reasoning !== 'string' && typeof delta.reasoning_content === 'string') {
          delta.reasoning = delta.reasoning_content;
        }
        delete delta.reasoning_content;
      }

      yield chunk;
    }
  }

  async stream(
    provider: Provider,
    params: {
      model: string;
      messages: ProviderChatMessage[];
      tools?: ProviderToolDefinition[];
      reasoning?: ProviderReasoningRequest;
    },
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    const apiKey = decrypt(provider.apiKeyEncrypted);
    const client = new OpenAI({ baseURL: provider.baseUrl, apiKey });

    this.logger.debug(`Streaming chat via provider=${provider.id}, model=${params.model}`);

    // Apply a total-generation deadline so a hung upstream does not
    // keep the connection open forever.
    const deadline = new Promise<never>((_resolve, reject) => {
      setTimeout(() => {
        reject(new NormalizedProviderError({
          code: 'provider_timeout',
          message: 'Provider generation timed out.',
          statusCode: 504,
          originalMessage: `Generation exceeded ${PROVIDER_TIMEOUTS.GENERATION_MS}ms`,
        }));
      }, PROVIDER_TIMEOUTS.GENERATION_MS);
    });

    const streamPromise = client.chat.completions.create({
      model: params.model,
      messages: params.messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId ?? '' };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((tc) => ({
              id: tc.id,
              type: 'function' as const,
              function: tc.function,
            })),
          };
        }
        return { role: m.role, content: m.content } as OpenAI.Chat.Completions.ChatCompletionMessageParam;
      }),
      ...(params.tools?.length ? { tools: params.tools } : {}),
      ...this.buildReasoningParams(provider, params.reasoning),
      stream: true,
      stream_options: { include_usage: true },
    });

    try {
      const stream = await Promise.race([streamPromise, deadline]);
      return this.normalizeReasoningDeltas(stream as AsyncIterable<unknown>);
    } catch (err) {
      // Normalize here so the failover layer classifies stable codes and the
      // client never sees an SDK message (which may include the base URL).
      throw normalizeStreamError(err);
    }
  }
}
