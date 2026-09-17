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

@Injectable()
export class OpenAICompatibleAdapter implements ProviderAdapter {
  private readonly logger = new Logger(OpenAICompatibleAdapter.name);

  supports(type: ProviderType): boolean {
    return type === 'openai-compatible';
  }

  async validate(provider: Provider): Promise<void> {
    const apiKey = decrypt(provider.apiKeyEncrypted);

    try {
      const res = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
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
        // Fallback: try a minimal chat probe
        const chatRes = await fetch(`${provider.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: 'probe', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        });
        if (chatRes.ok) return;
        throw new NormalizedProviderError({
          code: 'provider_request_invalid',
          message: 'Provider returned unexpected response to probe.',
          statusCode: 422,
          originalMessage: `HTTP ${chatRes.status}`,
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
    }
  }

  async stream(
    provider: Provider,
    params: { model: string; messages: ProviderChatMessage[] },
  ): Promise<AsyncIterable<ProviderStreamChunk>> {
    const apiKey = decrypt(provider.apiKeyEncrypted);
    const client = new OpenAI({ baseURL: provider.baseUrl, apiKey });

    this.logger.debug(`Streaming chat via provider=${provider.id}, model=${params.model}`);

    const stream = await client.chat.completions.create({
      model: params.model,
      messages: params.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      stream: true,
    });

    return stream as AsyncIterable<ProviderStreamChunk>;
  }
}
