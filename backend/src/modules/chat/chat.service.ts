import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { ModelsService } from '../models/models.service';
import { ModelAccessService } from '../models/model-access.service';
import { Model } from '../models/entities/model.entity';
import { ProviderRuntimeService, ProviderConnection } from '../provider/provider-runtime.service';
import { ProviderStreamChunk } from '../provider/adapters/provider-adapter.interface';
import { ConversationsService } from '../conversations/conversations.service';
import { UsageService } from '../usage/usage.service';
import { QuotaService } from '../quotas/quotas.service';
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
  providerStream: AsyncIterable<ProviderStreamChunk>;
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
    private readonly access: ModelAccessService,
    private readonly runtime: ProviderRuntimeService,
    private readonly conversations: ConversationsService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly usage: UsageService,
    private readonly quotas: QuotaService,
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
      let model: Model | null = null;

      // Explicit modelId validation: when the client picks a specific model we
      // verify existence + enabled FIRST (preserving the existing
      // `model_unavailable` contract for unknown/disabled ids), then verify
      // entitlement (`model_forbidden`). No conversation or provider work
      // happens for either failure.
      if (dto.modelId) {
        let explicit: Model | null = null;
        try {
          explicit = await this.models.findById(dto.modelId);
        } catch (err) {
          if (err instanceof NotFoundException) {
            explicit = null;
          } else {
            throw err;
          }
        }

        if (!explicit || !explicit.enabled) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'model_unavailable',
                message: 'The selected model is not available. Choose another model or remove the selection.',
              },
            });
          }
          observer.complete();
          return;
        }

        if (!(await this.access.canAccessUser(userId, explicit))) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'model_forbidden',
                message: 'You do not have access to this model.',
              },
            });
          }
          observer.complete();
          return;
        }

        model = explicit;
      }

      if (!model) {
        // No explicit selection (or it failed) → sticky/default resolver, which
        // is itself access-filtered.
        model = await this.models.resolveActiveModel({ explicitModelId: null, userId });
        if (!model) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'no_model_available',
                message: 'No model is available for your account. Ask an admin to grant access or set a default model.',
              },
            });
          }
          observer.complete();
          return;
        }
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

      const providerMessages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [
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

      // ── quota preflight ──────────────────────────────────────────
      // Must run BEFORE any provider work: a rejected request must never
      // consume upstream tokens. The reservation is corrected on completion
      // and fully released on failure.
      let quotaId: string | undefined;
      let quotaReservedTokens = 0;
      try {
        const estimatedTokens = Math.max(1, Math.ceil(dto.message.length / 4));
        const reservation = await this.quotas.checkAndReserve(userId, estimatedTokens);
        if (!reservation.reserved) {
          if (isActive()) {
            observer.next({
              event: 'error',
              data: {
                code: 'quota_exceeded',
                message: `You have reached your token limit. ${reservation.tokenRemaining.toLocaleString()} tokens remaining.`,
              },
            });
          }
          observer.complete();
          return;
        }
        quotaId = reservation.quotaId;
        quotaReservedTokens = estimatedTokens;
      } catch (err) {
        this.logger.warn(
          `Quota preflight failed open: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // ── provider runtime ───────────────────────────────────────────
      let connection: ProviderConnection;
      try {
        connection = await this.runtime.assertReady(model.id);
      } catch (err) {
        const failure = err as { response?: { code?: string; message?: string } };
        if (isActive()) {
          observer.next({
            event: 'error',
            data: {
              code: failure.response?.code ?? 'provider_error',
              message: failure.response?.message ?? 'Provider is not available.',
            },
          });
        }
        observer.complete();
        return;
      }

      // ── usage tracking ───────────────────────────────────────────
      let usageRecordId: string | undefined;
      try {
        const usageRecord = await this.usage.create({
          userId,
          conversationId,
          modelId: model.id,
          providerId: model.providerId,
        });
        usageRecordId = usageRecord.id;
      } catch (err) {
        this.logger.warn(`Failed to create usage record: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ── consume phase ───────────────────────────────────────────────
      let fullResponse = '';
      let lastChunk: ProviderStreamChunk | undefined;
      try {
        const stream = await this.runtime.stream(connection, {
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

        try {
          for await (const chunk of stream) {
            lastChunk = chunk;
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

          // Finalize usage with provider-reported token counts
          if (usageRecordId) {
            const usage = lastChunk?.usage;
            await this.usage.finalize(usageRecordId, {
              promptTokens: usage?.prompt_tokens ?? 0,
              completionTokens: usage?.completion_tokens ?? 0,
              totalTokens: usage?.total_tokens ?? 0,
              inputPricePer1k: model.inputPricePer1k,
              outputPricePer1k: model.outputPricePer1k,
              status: 'completed',
            }).catch((err) => this.logger.warn(`Failed to finalize usage: ${err}`));
          }

          // Correct the quota reservation to the actual token count
          if (quotaId) {
            const totalTokens = lastChunk?.usage?.total_tokens ?? 0;
            await this.quotas
              .finalize(quotaId, quotaReservedTokens + totalTokens)
              .catch((err) => this.logger.warn(`Failed to finalize quota: ${err}`));
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
        // Mark usage as failed
        if (usageRecordId) {
          await this.usage.finalize(usageRecordId, {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            inputPricePer1k: 0,
            outputPricePer1k: 0,
            status: 'failed',
          }).catch(() => {});
        }
        // Release the quota reservation — a failed request is not billed
        if (quotaId) {
          await this.quotas.refund(quotaId, quotaReservedTokens).catch(() => {});
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
