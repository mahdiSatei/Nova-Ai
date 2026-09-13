import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { Observable, of } from 'rxjs';
import OpenAI from 'openai';
import { ModelsService } from '../models/models.service';
import { OpenAICompatibleClient } from './provider/openai-compatible.client';
import { ConversationsService } from '../conversations/conversations.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ChatRequestDto } from './dto/chat-request.dto';

/**
 * Event shapes emitted on the SSE stream.
 */
export interface ChatDeltaEvent {
  data: { delta: string };
}

export interface ChatDoneEvent {
  event: 'done';
  data: Record<string, never>;
}

export interface ChatErrorEvent {
  event: 'error';
  data: { code: string; message: string };
}

export type ChatStreamEvent = ChatDeltaEvent | ChatDoneEvent | ChatErrorEvent;

/** Loose message shape used internally; cast to SDK types at the provider boundary. */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Core chat streaming service.
 *
 * Responsibilities:
 *  1. Resolve the active model (explicit → sticky → default).
 *  2. Verify central provider is configured.
 *  3. Validate message length (FR-014).
 *  4. Assemble prior conversation turns as `messages` (FR-015).
 *  5. Stream tokens from the provider via SSE.
 *  6. Persist user + assistant messages via ConversationsService.
 *
 * For T005 the conversation persistence is the in-memory stub.
 * US4 (T006) swaps this for a TypeORM-backed implementation.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly models: ModelsService,
    private readonly providerClient: OpenAICompatibleClient,
    private readonly conversations: ConversationsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Stream a chat completion as an RxJS Observable of SSE events.
   *
   * The controller returns this Observable synchronously to the
   * `@Sse()` decorator. All async setup (model resolution, provider
   * check, conversation creation) runs inside the Observable so
   * the controller method stays synchronous.
   */
  streamChat(userId: string, dto: ChatRequestDto): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let fullResponse = '';
      let aborted = false;

      const run = async () => {
        try {
          // 1. Resolve the active model.
          const model = await this.models.resolveActiveModel({
            explicitModelId: dto.modelId ?? null,
            userId,
          });

          if (!model) {
            observer.next({
              event: 'error',
              data: { code: 'no_model_available', message: 'No model is available. Ask an admin to set a default model or select one explicitly.' },
            });
            observer.complete();
            return;
          }

          // 2. Verify central provider is configured.
          try {
            await this.providerClient.getClient();
          } catch {
            observer.next({
              event: 'error',
              data: { code: 'provider_not_configured', message: 'Central provider is not configured. Ask an admin to set it up.' },
            });
            observer.complete();
            return;
          }

          // 3. Validate message length (FR-014).
          if (dto.message.length < 1 || dto.message.length > 32000) {
            observer.next({
              event: 'error',
              data: { code: 'invalid_message', message: 'Message must be 1..32000 characters.' },
            });
            observer.complete();
            return;
          }

          // 4. Resolve or create conversation.
          let conversationId: string;
          let priorTurns: ChatMessage[];

          if (dto.conversationId) {
            const existing = this.conversations.findById(dto.conversationId);
            if (!existing) {
              observer.next({
                event: 'error',
                data: { code: 'conversation_not_found', message: 'Conversation not found.' },
              });
              observer.complete();
              return;
            }
            conversationId = existing.id;
            priorTurns = existing.messages.map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }));
          } else {
            const conv = this.conversations.create({
              userId,
              modelId: model.id,
              userMessage: dto.message,
            });
            conversationId = conv.id;
            priorTurns = [{ role: 'user', content: dto.message }];
          }

          // 5. Persist sticky model choice (fire-and-forget).
          this.updateUserLastSelectedModel(userId, model.id).catch(() => {
            this.logger.warn(`Failed to update lastSelectedModelId for user ${userId}`);
          });

          // 6. Build the messages array for the provider (FR-015).
          const providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
            ...priorTurns,
            { role: 'user', content: dto.message },
          ];

          // 7. Stream from the provider.
          await this.consumeStream(model.actualName, providerMessages, conversationId, observer, { value: aborted });
        } catch (err) {
          if (!aborted) {
            this.logger.error(`Chat setup error: ${err instanceof Error ? err.message : err}`);
            observer.next({
              event: 'error',
              data: { code: 'internal_error', message: 'An unexpected error occurred.' },
            });
            observer.complete();
          }
        }
      };

      run();

      // Teardown: called when the client disconnects or the
      // Observable is unsubscribed.
      return {
        unsubscribe() {
          aborted = true;
        },
      };
    });
  }

  // ─────────────────────────────── private ─────────────────────────────────

  private async updateUserLastSelectedModel(userId: string, modelId: string): Promise<void> {
    await this.userRepo.update({ id: userId }, { lastSelectedModelId: modelId });
  }

  /**
   * Consume the OpenAI stream and emit SSE events.
   */
  private async consumeStream(
    actualModelName: string,
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    conversationId: string,
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
    abortedRef: { value: boolean },
  ): Promise<void> {
    let fullResponse = '';

    try {
      const stream = await this.providerClient.stream({
        model: actualModelName,
        messages,
      });

      for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (abortedRef.value) break;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullResponse += delta;
          observer.next({ data: { delta } });
        }
      }

      if (!abortedRef.value) {
        observer.next({ event: 'done', data: {} });
      }
    } catch (err) {
      if (!abortedRef.value) {
        this.logger.error(`Provider stream error: ${err instanceof Error ? err.message : err}`);
        observer.next({
          event: 'error',
          data: { code: 'provider_error', message: 'The model provider returned an error.' },
        });
      }
    } finally {
      if (fullResponse) {
        this.conversations.appendMessage(conversationId, fullResponse);
      }
      observer.complete();
    }
  }
}
