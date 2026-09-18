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
 *
 * IMPORTANT: NestJS's SSE serializer (@nestjs/core SseStream) reads the
 * event name from the `type` property of each emitted object — an `event`
 * property is silently DROPPED and the frame goes out unnamed (the client
 * sees it as a default `message` event). Always use `type` here.
 */
export interface ChatDeltaEvent {
  data: { delta: string };
}

export interface ChatDoneEvent {
  type: 'done';
  data: Record<string, never>;
}

export interface ChatStartEvent {
  type: 'start';
  data: { conversationId: string; assistantMessageId: string };
}

export interface ChatErrorEvent {
  type: 'error';
  data: { code: string; message: string };
}

export type ChatStreamEvent =
  | ChatDeltaEvent
  | ChatStartEvent
  | ChatDoneEvent
  | ChatErrorEvent;

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
  providerStream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> | null;
  /** Aborting this cancels the upstream provider request. */
  abortController: AbortController;
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
 *  - Both a normal send (runStream) and a retry of a failed/cancelled
 *    message (runRetry) share the same consume + finalize pipeline.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  /**
   * In-memory registry of active streams keyed by conversationId.
   * Only one active stream per conversation is allowed.
   */
  private readonly activeStreams = new Map<string, StreamState>();

  /**
   * Assistant-message ids whose generation was cancelled while the
   * stream was still in its setup phase (not yet registered in
   * activeStreams). The consume pipeline checks this right after
   * registering so a cancel that lands in the pre-first-token window
   * still takes effect.
   */
  private readonly pendingCancels = new Set<string>();

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

  /**
   * Retry a failed/cancelled generation as a live SSE stream.
   * Validates the conversation + target message, creates a new streaming
   * assistant row, then runs the same provider pipeline as a normal
   * send.
   */
  retryGenerationStream(
    userId: string,
    conversationId: string,
    failedMessageId: string,
  ): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let cancelled = false;
      void this.runRetry(userId, conversationId, failedMessageId, observer, () => !cancelled);
      return () => {
        cancelled = true;
      };
    });
  }

  // ─────────────────────────────── private ─────────────────────────────────

  /** Emit an SSE error event and close the stream. */
  private failStream(
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
    isActive: () => boolean,
    code: string,
    message: string,
  ): void {
    if (isActive()) {
      observer.next({ type: 'error', data: { code, message } });
    }
    observer.complete();
  }

  /** Deliver an SSE event to every current subscriber of a stream. */
  private broadcast(state: StreamState, event: ChatStreamEvent): void {
    for (const sub of state.subscribers) {
      sub(event);
    }
  }

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
    // Abort the upstream provider request and notify live subscribers so
    // every connected client converges on the cancelled state.
    const state = this.activeStreams.get(conversationId);
    if (state) {
      state.abortController.abort();
      this.broadcast(state, {
        type: 'error',
        data: { code: 'generation_cancelled', message: 'Generation was cancelled.' },
      });
      this.activeStreams.delete(conversationId);
    } else {
      // Stream not registered yet (setup phase). Remember the cancel so
      // the consume pipeline aborts as soon as the provider stream is
      // registered.
      this.pendingCancels.add(streaming.id);
    }
    return result;
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
            type: 'error',
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
            type: 'error',
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
            type: 'error',
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
              type: 'error',
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
              type: 'error',
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

        // Persist this turn's user message. (The first user message of a
        // conversation is persisted by `create`; subsequent turns must be
        // saved here or they vanish from the transcript on reload.)
        await this.conversations.appendUserMessage(conversationId, dto.message);
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
            type: 'error',
            data: { code: 'internal_error', message: 'Failed to create assistant message.' },
          });
        }
        observer.complete();
        return;
      }
      assistantMessageId = assistantMessage.id;
      await this.conversations.updateMessageStatus(assistantMessageId, 'streaming');

      // Tell the client the real conversation + assistant message ids so it
      // can route deltas, cancellation, and retries correctly.
      observer.next({
        type: 'start',
        data: { conversationId, assistantMessageId },
      });

      // ── consume phase (shared with the retry pipeline) ─────────────
      await this.consumeAndFinalize({
        conversationId,
        assistantMessageId,
        modelName: model.actualName,
        providerMessages,
        observer,
        isActive,
      });
    } catch (err) {
      this.logger.error(
        `Chat setup error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isActive()) {
        observer.next({
          type: 'error',
          data: { code: 'internal_error', message: 'An unexpected error occurred.' },
        });
      }
      observer.complete();
    }
  }

  /**
   * Open the provider stream, register it for reconnects/cancellation,
   * consume all tokens, and finalize the assistant message
   * (completed / cancelled / failed). Shared by send and retry.
   */
  private async consumeAndFinalize(params: {
    conversationId: string;
    assistantMessageId: string;
    modelName: string;
    providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void };
    isActive: () => boolean;
  }): Promise<void> {
    const { conversationId, assistantMessageId, modelName, providerMessages, observer, isActive } =
      params;
    let fullResponse = '';
    const abortController = new AbortController();
    try {
      const stream = await this.providerClient.stream({
        model: modelName,
        messages: providerMessages,
        signal: abortController.signal,
      });

      const state: StreamState = {
        fullResponse: '',
        subscribers: new Set([observer.next.bind(observer)]),
        providerStream: stream,
        abortController,
        conversationId,
        assistantMessageId,
      };
      this.activeStreams.set(conversationId, state);

      if (this.pendingCancels.delete(assistantMessageId)) {
        // A cancel landed between assistant-message creation and stream
        // registration. Abort immediately without consuming; the DB row
        // is already 'cancelled'.
        abortController.abort();
        this.broadcast(state, {
          type: 'error',
          data: { code: 'generation_cancelled', message: 'Generation was cancelled.' },
        });
        this.activeStreams.delete(conversationId);
      } else {
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

          // Stream completed successfully — unless a concurrent cancel
          // already marked the message cancelled. The conditional write
          // makes that check atomic: a cancelled row is never
          // resurrected to completed.
          const completed = await this.conversations.completeIfStreaming(
            assistantMessageId,
            fullResponse,
          );
          if (completed) {
            for (const sub of state.subscribers) {
              sub({ type: 'done', data: {} });
            }
          } else {
            this.broadcast(state, {
              type: 'error',
              data: { code: 'generation_cancelled', message: 'Generation was cancelled.' },
            });
          }
        } finally {
          this.activeStreams.delete(conversationId);
        }
      }
    } catch (err) {
      this.pendingCancels.delete(assistantMessageId);
      if (abortController.signal.aborted) {
        // User-initiated cancellation: DB row is already 'cancelled' and
        // subscribers were notified by cancelGeneration. Do not overwrite
        // the status or emit a provider error.
        this.logger.debug(`Provider stream aborted for message ${assistantMessageId}`);
      } else {
        // Surface the upstream cause (status, model id, SDK message) —
        // "The model provider returned an error." alone is undebuggable.
        const status =
          typeof (err as { status?: number })?.status === 'number'
            ? (err as { status: number }).status
            : undefined;
        const upstream = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Provider stream error (status=${status ?? 'n/a'}, model=${modelName}): ${upstream}`,
        );
        if (isActive()) {
          observer.next({
            type: 'error',
            data: {
              code: 'provider_error',
              message: `The model provider returned an error${status ? ` (HTTP ${status})` : ''}: ${upstream}`,
            },
          });
        }
        await this.conversations.updateMessageStatus(assistantMessageId, 'failed', fullResponse);
      }
    } finally {
      observer.complete();
    }
  }

  /**
   * Run a retry generation for a failed/cancelled assistant message.
   * Validates ownership and retryability, builds prior turns from the DB
   * (excluding failed/cancelled rows), creates the new assistant row,
   * and reuses the shared consume pipeline.
   */
  private async runRetry(
    userId: string,
    conversationId: string,
    failedMessageId: string,
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
    isActive: () => boolean,
  ): Promise<void> {
    try {
      const model = await this.models.resolveActiveModel({ explicitModelId: null, userId });
      if (!model) {
        return this.failStream(
          observer,
          isActive,
          'no_model_available',
          'No model is available. Ask an admin to set a default model or select one explicitly.',
        );
      }

      try {
        await this.providerClient.getClient();
      } catch {
        return this.failStream(
          observer,
          isActive,
          'provider_not_configured',
          'Central provider is not configured. Ask an admin to set it up.',
        );
      }

      const conversation = await this.conversations.findById(conversationId);
      if (!conversation) {
        return this.failStream(observer, isActive, 'conversation_not_found', 'Conversation not found.');
      }
      if (conversation.userId !== userId) {
        return this.failStream(observer, isActive, 'forbidden', 'You do not own this conversation.');
      }

      const targetMsg = conversation.messages.find((m) => m.id === failedMessageId);
      if (!targetMsg) {
        return this.failStream(
          observer,
          isActive,
          'message_not_found',
          'The specified message does not belong to this conversation.',
        );
      }
      if (targetMsg.status !== 'failed' && targetMsg.status !== 'cancelled') {
        return this.failStream(
          observer,
          isActive,
          'message_not_retryable',
          'Only failed or cancelled messages can be retried.',
        );
      }

      // One active generation per conversation (FR-6).
      const existingStream = await this.conversations.findStreamingMessage(conversationId);
      if (existingStream) {
        return this.failStream(
          observer,
          isActive,
          'generation_in_progress',
          'A generation is already in progress for this conversation. Wait for it to complete or cancel it.',
        );
      }

      // Prior turns from the DB. Failed/cancelled assistant rows carry no
      // useful context and are excluded — including the retried target —
      // so the transcript ends on the last good exchange.
      const priorTurns: ChatMessage[] = conversation.messages
        .filter((m) => m.status !== 'failed' && m.status !== 'cancelled')
        .map((m) => ({ role: m.role as ChatMessage['role'], content: m.content }));

      const providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [...priorTurns];

      // ── create assistant message with status=streaming ─────────────
      const assistantMessage = await this.conversations.appendMessage(conversationId, '');
      if (!assistantMessage) {
        return this.failStream(observer, isActive, 'internal_error', 'Failed to create assistant message.');
      }
      const assistantMessageId = assistantMessage.id;
      await this.conversations.updateMessageStatus(assistantMessageId, 'streaming');

      observer.next({
        type: 'start',
        data: { conversationId, assistantMessageId },
      });

      await this.consumeAndFinalize({
        conversationId,
        assistantMessageId,
        modelName: model.actualName,
        providerMessages,
        observer,
        isActive,
      });
    } catch (err) {
      this.logger.error(
        `Retry setup error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isActive()) {
        observer.next({
          type: 'error',
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
