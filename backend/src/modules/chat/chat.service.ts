import { Injectable, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
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
   * Uses a Subject-based hot-stream pattern: the Observable is shared
   * so reconnecting clients can receive accumulated content + new
   * tokens. A new generation is rejected (409 Conflict) if an active
   * streaming message already exists for this conversation.
   *
   * Message lifecycle:
   *   1. Create assistant message with status='streaming' before consuming.
   *   2. Update status='completed' on success, 'failed' on error.
   *   3. Content is persisted progressively via updateMessageStatus.
   */
  streamChat(userId: string, dto: ChatRequestDto): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let cancelled = false;

      void this.runStream(userId, dto, observer, () => !cancelled);

      return () => {
        cancelled = true;
      };
    });
  }

  // ─────────────────────────────── private ─────────────────────────────────

  private async updateUserLastSelectedModel(userId: string, modelId: string): Promise<void> {
    await this.userRepo.update({ id: userId }, { lastSelectedModelId: modelId });
  }

  /**
   * Cancel the active generation for a conversation.
   * Finds the streaming message internally, then delegates to ConversationsService.
   */
  async cancelGeneration(conversationId: string, requesterId: string) {
    const streaming = await this.conversations.findStreamingMessage(conversationId);
    if (!streaming) return null;
    return this.conversations.cancelGeneration(conversationId, streaming.id, requesterId);
  }

  /**
   * Retry a failed generation by creating a new streaming assistant message.
   * Delegates to ConversationsService.retryGeneration.
   */
  async retryGeneration(conversationId: string, failedMessageId: string, requesterId: string) {
    return this.conversations.retryGeneration(conversationId, failedMessageId, requesterId);
  }

  private async runStream(
    userId: string,
    dto: ChatRequestDto,
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
    isActive: () => boolean,
  ): Promise<void> {
    let conversationId: string | undefined;
    let assistantMessageId: string | undefined;
    let fullResponse = '';

    try {
      // ── setup phase ─────────────────────────────────────────────────
      const model = await this.models.resolveActiveModel({
        explicitModelId: dto.modelId ?? null,
        userId,
      });
      if (!model) {
        if (isActive()) {
          observer.next({
            event: 'error',
            data: {
              code: 'no_model_available',
              message: 'No model is available. Ask an admin to set a default model or select one explicitly.',
            },
          });
        }
        observer.complete();
        return;
      }

      try {
        await this.providerClient.getClient();
      } catch {
        if (isActive()) {
          observer.next({
            event: 'error',
            data: {
              code: 'provider_not_configured',
              message: 'Central provider is not configured. Ask an admin to set it up.',
            },
          });
        }
        observer.complete();
        return;
      }

      if (dto.message.length < 1 || dto.message.length > 32000) {
        if (isActive()) {
          observer.next({
            event: 'error',
            data: { code: 'invalid_message', message: 'Message must be 1..32000 characters.' },
          });
        }
        observer.complete();
        return;
      }

      // Resolve or create conversation.
      let priorTurns: ChatMessage[];
      if (dto.conversationId) {
        const existing = await this.conversations.findById(dto.conversationId);
        if (!existing) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: { code: 'conversation_not_found', message: 'Conversation not found.' },
            });
          }
          observer.complete();
          return;
        }
        conversationId = existing.id;

        // FR-6: Check for existing active generation (one active gen per conversation).
        const existingStream = await this.conversations.findStreamingMessage(conversationId);
        if (existingStream) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'generation_in_progress',
                message: 'A generation is already in progress for this conversation. Wait for it to complete or cancel it.',
              },
            });
          }
          observer.complete();
          return;
        }

        priorTurns = existing.messages.map(
          (m) => ({ role: m.role as ChatMessage['role'], content: m.content }),
        );
      } else {
        const conv = await this.conversations.create({
          userId,
          modelId: model.id,
          userMessage: dto.message,
        });
        conversationId = conv.id;
        priorTurns = [{ role: 'user', content: dto.message }];
      }

      this.updateUserLastSelectedModel(userId, model.id).catch(() => {
        this.logger.warn(`Failed to update lastSelectedModelId for user ${userId}`);
      });

      const providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...priorTurns,
        { role: 'user', content: dto.message },
      ];

      // ── create assistant message with status=streaming ───────────────
      const assistantMessage = await this.conversations.appendMessage(
        conversationId,
        '',
      );
      if (!assistantMessage) {
        if (isActive()) {
          observer.next({
            event: 'error',
            data: { code: 'internal_error', message: 'Failed to create assistant message.' },
          });
        }
        observer.complete();
        return;
      }
      assistantMessageId = assistantMessage.id;
      await this.conversations.updateMessageStatus(assistantMessageId, 'streaming');

      // ── consume phase ───────────────────────────────────────────────
      try {
        const stream = await this.providerClient.stream({
          model: model.actualName,
          messages: providerMessages,
        });

        for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta; // always accumulate, even after disconnect
            if (isActive()) {
              await this.conversations.updateMessageStatus(assistantMessageId, 'streaming', fullResponse);
              observer.next({ data: { delta } });
            }
          }
        }

        if (isActive()) {
          observer.next({ event: 'done', data: {} });
        }
        await this.conversations.updateMessageStatus(assistantMessageId, 'completed', fullResponse);
      } catch (err) {
        this.logger.error(
          `Provider stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (isActive()) {
          observer.next({
            event: 'error',
            data: {
              code: 'provider_error',
              message: 'The model provider returned an error.',
            },
          });
        }
        if (assistantMessageId) {
          await this.conversations.updateMessageStatus(assistantMessageId, 'failed', fullResponse);
        }
      } finally {
        observer.complete();
      }
    } catch (err) {
      this.logger.error(
        `Chat setup error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isActive()) {
        observer.next({
          event: 'error',
          data: { code: 'internal_error', message: 'An unexpected error occurred.' },
        });
      }
      observer.complete();
    }
  }
}
