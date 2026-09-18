import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { decrypt } from '../../../common/crypto/credential-cipher';
import { Provider, ProviderType } from '../entities/provider.entity';
import {
  ProviderAdapter,
  ProviderChatMessage,
  ProviderStreamChunk,
} from './provider-adapter.interface';
import { NormalizedProviderError } from '../errors/normalized-provider.error';
import { normalizeStreamError } from '../failure-classification';
import { PROVIDER_TIMEOUTS } from '../constants/provider-timeouts';

@Injectable()
export class OpenAICompatibleAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenAICompatibleAdapter.name);

  supports(type: ProviderType): boolean {
    return type === 'openai-compatible';
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

  async stream(
    provider: Provider,
    params: { model: string; messages: ProviderChatMessage[] },
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
      messages: params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
    });

    try {
      const stream = await Promise.race([streamPromise, deadline]);
      return stream as AsyncIterable<ProviderStreamChunk>;
    } catch (err) {
      // Normalize here so the failover layer classifies stable codes and the
      // client never sees an SDK message (which may include the base URL).
      throw normalizeStreamError(err);
    }
  }
}
