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
 * Holds the in-progress stream state for a conversation.
 * Lives in memory only — no DB writes during streaming.
 */
interface StreamState {
  /** Accumulated full response text. */
  fullResponse: string;
  /** Active SSE subscribers for this stream. */
  subscribers: Set<(e: ChatStreamEvent) => void>;
  /** The underlying provider async iterator (kept so we can consume it). */
  providerStream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
  /** Conversation + assistant message ids for DB writes at the end. */
  conversationId: string;
  assistantMessageId: string;
}

/**
 * Core chat streaming service.
 *
 * Architecture:
 *  - A single provider stream is created per conversation and held in
 *    memory (this.activeStreams Map). All SSE subscribers — including
 *    reconnecting clients — receive the same accumulated + live tokens.
 *  - DB writes happen only at stream boundaries: create (status='streaming'),
 *    complete (status='completed' + full content), fail (status='failed' + content),
 *    cancel (status='cancelled').
 *  - This eliminates per-chunk DB writes and enables reconnect/resume
 *    without touching the database mid-stream.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  /**
   * In-memory registry of active streams keyed by conversationId.
   * Only one active stream per conversation is allowed.
   */
  private readonly activeStreams = new Map<string, StreamState>();

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
   * If an active stream already exists for this conversation, the new
   * subscriber receives all accumulated content plus any new tokens —
   * this is the reconnect/resume path.
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
    const result = await this.conversations.cancelGeneration(conversationId, streaming.id, requesterId);
    // Remove from in-memory state so no more tokens are emitted.
    this.activeStreams.delete(conversationId);
    return result;
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
      let fullResponse = '';
      try {
        const stream = await this.providerClient.stream({
          model: model.actualName,
          messages: providerMessages,
        });

        const state: StreamState = {
          fullResponse: '',
          subscribers: new Set([observer.next.bind(observer)]),
          providerStream: stream,
          conversationId,
          assistantMessageId,
        };
        this.activeStreams.set(conversationId, state);

        let streamStarted = false;
        try {
          for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              fullResponse += delta;
              state.fullResponse += delta;
              // Emit to all current subscribers (original + any reconnects).
              for (const sub of state.subscribers) {
                sub({ data: { delta } });
              }
            }
          }

          // Stream completed successfully.
          await this.conversations.updateMessageStatus(assistantMessageId, 'completed', fullResponse);
          for (const sub of state.subscribers) {
            sub({ event: 'done', data: {} });
          }
        } finally {
          this.activeStreams.delete(conversationId);
        }
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

  /**
   * Subscribe to an already-active stream for a conversation.
   * Sends all accumulated content as individual delta events, then
   * registers the subscriber to receive new tokens.
   *
   * Returns false if no active stream exists for the conversation.
   */
  subscribeToActiveStream(conversationId: string, observer: { next: (e: ChatStreamEvent) => void }): boolean {
    const state = this.activeStreams.get(conversationId);
    if (!state) return false;

    // Send accumulated content so the reconnecting client catches up.
    if (state.fullResponse.length > 0) {
      observer.next({ data: { delta: state.fullResponse } });
    }

    // Register for future tokens.
    state.subscribers.add(observer.next.bind(observer));
    return true;
  }
}
