import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { decrypt } from '../../../common/crypto/credential-cipher';
import { CentralProvider } from '../../../modules/provider/entities/central-provider.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

type ChatStream = AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

/**
 * Wraps the `openai` SDK for the MVP's single central provider.
 *
 * The base URL and API key are read fresh from the `CentralProvider`
 * singleton row on every call — no caching — so admin changes to the
 * provider config take effect immediately without a restart.
 */
@Injectable()
export class OpenAICompatibleClient {
  private readonly logger = new Logger(OpenAICompatibleClient.name);

  constructor(
    @InjectRepository(CentralProvider)
    private readonly providerRepo: Repository<CentralProvider>,
  ) {}

  /**
   * Build a fresh OpenAI client configured for the current central
   * provider. Throws if no provider is configured.
   */
  async getClient(): Promise<OpenAI> {
    const provider = await this.providerRepo.findOne({ where: { id: 'singleton' } });
    if (!provider) {
      throw new Error('Central provider not configured');
    }

    const apiKey = decrypt(provider.apiKeyEncrypted);
    return new OpenAI({
      baseURL: provider.baseUrl,
      apiKey,
    });
  }

  /**
   * Start a streaming chat completion. Returns the raw OpenAI stream
   * object; the caller iterates it and extracts `chunk.choices[0]?.delta?.content`.
   */
  async stream(params: {
    model: string;
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  }): Promise<ChatStream> {
    const client = await this.getClient();

    this.logger.debug(`Streaming chat: model=${params.model}, messages=${params.messages.length}`);

    const stream = await client.chat.completions.create({
      model: params.model,
      messages: params.messages,
      stream: true,
    });

    return stream as ChatStream;
  }
}
