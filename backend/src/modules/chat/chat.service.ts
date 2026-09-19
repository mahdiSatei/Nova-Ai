import OpenAI from 'openai';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ModelsService } from '../models/models.service';
import { ModelAccessService } from '../models/model-access.service';
import { Model } from '../models/entities/model.entity';
import { ProviderRuntimeService } from '../provider/provider-runtime.service';
import { ProviderStreamChunk, ProviderChatMessage } from '../provider/adapters/provider-adapter.interface';
import {
  ProviderFailoverService,
  AllProvidersUnavailableError,
  EstablishedStream,
} from '../provider/provider-failover.service';
import { ConversationsService } from '../conversations/conversations.service';
import { UsageService } from '../usage/usage.service';
import { QuotaService } from '../quotas/quotas.service';
import { User } from '../users/entities/user.entity';
import { ChatRequestDto } from './dto/chat-request.dto';

/**
 * Event shapes emitted on the SSE stream.
 *
 * IMPORTANT: NestJS's SSE serializer (@nestjs/core SseStream) reads the
 * event name from the `type` property of each emitted object. Always use
 * `type`, not `event`.
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

export interface ChatStatusEvent {
  type: 'status';
  data: {
    phase: 'retrying';
    attempt: number;
    maxAttempts: number;
  };
}

export type ChatStreamEvent =
  | ChatDeltaEvent
  | ChatStartEvent
  | ChatDoneEvent
  | ChatErrorEvent
  | ChatStatusEvent;

/**
 * Loose message shape used internally.
 */
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Holds the in-progress stream state for a conversation.
 */
interface StreamState {
  fullResponse: string;
  subscribers: Set<(event: ChatStreamEvent) => void>;
  providerStream: AsyncIterable<ProviderStreamChunk>;
  abortController: AbortController;
  conversationId: string;
  assistantMessageId: string;
}

/**
 * Core chat streaming service.
 *
 * Architecture:
 * - One active provider stream per conversation.
 * - Active streams are kept in memory so reconnecting clients can catch up.
 * - Database writes happen at stream boundaries rather than per token.
 * - Normal sends and retries share consumeAndFinalize().
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  /**
   * In-memory registry of active streams keyed by conversationId.
   */
  private readonly activeStreams = new Map<string, StreamState>();

  /**
   * Assistant-message ids cancelled before the provider stream was registered.
   */
  private readonly pendingCancels = new Set<string>();

  constructor(
    private readonly models: ModelsService,
    private readonly access: ModelAccessService,
    private readonly runtime: ProviderRuntimeService,
    private readonly conversations: ConversationsService,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly usage: UsageService,
    private readonly quotas: QuotaService,
    private readonly failover: ProviderFailoverService,
  ) {}

  /**
   * Stream a chat completion as an RxJS Observable of SSE events.
   *
   * If an active stream already exists for this conversation, the new
   * subscriber can use subscribeToActiveStream() to resume it.
   */
  streamChat(
    userId: string,
    dto: ChatRequestDto,
  ): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let cancelled = false;

      void this.runStream(
        userId,
        dto,
        observer,
        () => !cancelled,
      );

      return () => {
        cancelled = true;
      };
    });
  }

  /**
   * Retry a failed/cancelled generation as a live SSE stream.
   */
  retryGenerationStream(
    userId: string,
    conversationId: string,
    failedMessageId: string,
  ): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let cancelled = false;

      void this.runRetry(
        userId,
        conversationId,
        failedMessageId,
        observer,
        () => !cancelled,
      );

      return () => {
        cancelled = true;
      };
    });
  }

  // ─────────────────────────────── private ────────────────────────────────

  private failStream(
    observer: {
      next: (event: ChatStreamEvent) => void;
      complete: () => void;
    },
    isActive: () => boolean,
    code: string,
    message: string,
  ): void {
    if (isActive()) {
      observer.next({
        type: 'error',
        data: { code, message },
      });
    }

    observer.complete();
  }

  private broadcast(
    state: StreamState,
    event: ChatStreamEvent,
  ): void {
    for (const subscriber of state.subscribers) {
      subscriber(event);
    }
  }

  private async updateUserLastSelectedModel(
    userId: string,
    modelId: string,
  ): Promise<void> {
    await this.userRepo.update(
      { id: userId },
      { lastSelectedModelId: modelId },
    );
  }

  /**
   * Cancel the active generation for a conversation.
   */
  async cancelGeneration(
    conversationId: string,
    requesterId: string,
  ) {
    const streaming =
      await this.conversations.findStreamingMessage(conversationId);

    if (!streaming) {
      return null;
    }

    const result =
      await this.conversations.cancelGeneration(
        conversationId,
        streaming.id,
        requesterId,
      );

    const state = this.activeStreams.get(conversationId);

    if (state) {
      state.abortController.abort();

      this.broadcast(state, {
        type: 'error',
        data: {
          code: 'generation_cancelled',
          message: 'Generation was cancelled.',
        },
      });

      this.activeStreams.delete(conversationId);
    } else {
      // Cancellation happened during setup, before the stream was registered.
      this.pendingCancels.add(streaming.id);
    }

    return result;
  }

  private async runStream(
    userId: string,
    dto: ChatRequestDto,
    observer: {
      next: (event: ChatStreamEvent) => void;
      complete: () => void;
    },
    isActive: () => boolean,
  ): Promise<void> {
    let conversationId: string | undefined;
    let assistantMessageId: string | undefined;

    try {
      // ── validate message ────────────────────────────────────────────────

      if (
        dto.message.length < 1 ||
        dto.message.length > 32000
      ) {
        return this.failStream(
          observer,
          isActive,
          'invalid_message',
          'Message must be 1..32000 characters.',
        );
      }

      // ── resolve model ──────────────────────────────────────────────────

      let model: Model | null = null;

      let explicit: Model | null = null;

      if (dto.modelId) {
        try {
          explicit = await this.models.findById(dto.modelId);
        } catch (err) {
          if (!(err instanceof NotFoundException)) {
            throw err;
          }
        }

        if (!explicit || !explicit.enabled) {
          return this.failStream(
            observer,
            isActive,
            'model_unavailable',
            'The selected model is not available. Choose another model or remove the selection.',
          );
        }

        model = explicit;
      } else {
        model = await this.models.resolveActiveModel({
          explicitModelId: null,
          userId,
        });

        if (!model) {
          return this.failStream(
            observer,
            isActive,
            'no_model_available',
            'No model is available for your account. Ask an admin to grant access or set a default model.',
          );
        }
      }

      // ── provider readiness ─────────────────────────────────────────────

      try {
        await this.runtime.assertReady(model.id);
      } catch {
        return this.failStream(
          observer,
          isActive,
          'provider_not_configured',
          'Central provider is not configured. Ask an admin to set it up.',
        );
      }

      // ── resolve/create conversation ────────────────────────────────────

      let priorTurns: ProviderChatMessage[];

      if (dto.conversationId) {
        const existing =
          await this.conversations.findById(dto.conversationId);

        if (!existing) {
          return this.failStream(
            observer,
            isActive,
            'conversation_not_found',
            'Conversation not found.',
          );
        }

        if (existing.userId !== userId) {
          return this.failStream(
            observer,
            isActive,
            'forbidden',
            'You do not own this conversation.',
          );
        }

        conversationId = existing.id;

        // One active generation per conversation.
        const existingStream =
          await this.conversations.findStreamingMessage(
            conversationId,
          );

        if (existingStream) {
          return this.failStream(
            observer,
            isActive,
            'generation_in_progress',
            'A generation is already in progress for this conversation. Wait for it to complete or cancel it.',
          );
        }

        priorTurns = existing.messages.map((message) => ({
          role: message.role,
          content: message.content,
        }));

        // Existing conversations need their new user message persisted.
        await this.conversations.appendUserMessage(
          conversationId,
          dto.message,
        );
      } else {
        const conversation =
          await this.conversations.create({
            userId,
            modelId: model.id,
            userMessage: dto.message,
          });

        conversationId = conversation.id;

        // The user message was already persisted by create().
        // It is added below exactly once to providerMessages.
        priorTurns = [];
      }

      void this.updateUserLastSelectedModel(
        userId,
        model.id,
      ).catch(() => {
        this.logger.warn(
          `Failed to update lastSelectedModelId for user ${userId}`,
        );
      });

      const providerMessages: ProviderChatMessage[] = [
        ...priorTurns,
        {
          role: 'user',
          content: dto.message,
        },
      ];

      // ── create assistant message ───────────────────────────────────────

      const assistantMessage =
        await this.conversations.appendMessage(
          conversationId,
          '',
        );

      if (!assistantMessage) {
        return this.failStream(
          observer,
          isActive,
          'internal_error',
          'Failed to create assistant message.',
        );
      }

      assistantMessageId = assistantMessage.id;

      await this.conversations.updateMessageStatus(
        assistantMessageId,
        'streaming',
      );

      // ── quota preflight ─────────────────────────────────────────────────

      let quotaId: string | undefined;
      let quotaReservedTokens = 0;

      try {
        const estimatedTokens = Math.max(
          1,
          Math.ceil(dto.message.length / 4),
        );

        const reservation =
          await this.quotas.checkAndReserve(
            userId,
            estimatedTokens,
          );

        if (!reservation.reserved) {
          // Do not leave the assistant message permanently streaming.
          await this.conversations.updateMessageStatus(
            assistantMessageId,
            'failed',
            '',
          );

          return this.failStream(
            observer,
            isActive,
            'quota_exceeded',
            `You have reached your token limit. ${reservation.tokenRemaining.toLocaleString()} tokens remaining.`,
          );
        }

        quotaId = reservation.quotaId;
        quotaReservedTokens = estimatedTokens;
      } catch (err) {
        this.logger.warn(
          `Quota preflight failed open: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // ── provider establishment ─────────────────────────────────────────

      let established: EstablishedStream;

      try {
        established = await this.failover.establish({
          model,
          messages: providerMessages,
          isAllowed: (candidate) =>
            this.access.canAccessUser(
              userId,
              candidate,
            ),
          onRetry: ({
            attempt,
            maxAttempts,
          }) => {
            if (isActive()) {
              observer.next({
                type: 'status',
                data: {
                  phase: 'retrying',
                  attempt,
                  maxAttempts,
                },
              });
            }
          },
        });
      } catch (err) {
        if (err instanceof AllProvidersUnavailableError) {
          this.logger.error(
            `All provider candidates failed: attempts=${err.attempts} codes=${err.failures
              .map((failure) => failure.code)
              .join(',')}`,
          );

          if (isActive()) {
            observer.next({
              type: 'error',
              data: {
                code: 'all_providers_unavailable',
                message:
                  'The selected model is temporarily unavailable. Please try again in a moment.',
              },
            });
          }

          await this.conversations.updateMessageStatus(
            assistantMessageId,
            'failed',
            '',
          );

          await this.recordFailedUsage({
            userId,
            conversationId,
            model,
            attempts: err.attempts,
          });

          if (quotaId) {
            await this.quotas
              .refund(
                quotaId,
                quotaReservedTokens,
              )
              .catch(() => {});
          }

          observer.complete();
          return;
        }

        throw err;
      }

      const effectiveModel = established.model;

      // ── usage tracking ─────────────────────────────────────────────────

      let usageRecordId: string | undefined;

      try {
        const usageRecord =
          await this.usage.create({
            userId,
            conversationId,
            modelId: effectiveModel.id,
            providerId: effectiveModel.providerId,
            attempts: established.attempts,
          });

        usageRecordId = usageRecord.id;
      } catch (err) {
        this.logger.warn(
          `Failed to create usage record: ${
            err instanceof Error
              ? err.message
              : String(err)
          }`,
        );
      }

      // ── consume ────────────────────────────────────────────────────────

      observer.next({
        type: 'start',
        data: {
          conversationId,
          assistantMessageId,
        },
      });

      await this.consumeAndFinalize({
        conversationId,
        assistantMessageId,
        modelName: effectiveModel.actualName,
        providerMessages,
        observer,
        isActive,
        usageRecordId,
        quotaId,
        quotaReservedTokens,
        effectiveModel,
      });
    } catch (err) {
      this.logger.error(
        `Chat setup error: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`,
      );

      if (assistantMessageId) {
        await this.conversations
          .updateMessageStatus(
            assistantMessageId,
            'failed',
          )
          .catch(() => {});
      }

      if (isActive()) {
        observer.next({
          type: 'error',
          data: {
            code: 'internal_error',
            message: 'An unexpected error occurred.',
          },
        });
      }

      observer.complete();
    }
  }

  /**
   * Open the provider stream, register it for reconnects/cancellation,
   * consume all tokens, and finalize the assistant message.
   */
  private async consumeAndFinalize(params: {
    conversationId: string;
    assistantMessageId: string;
    modelName: string;
    providerMessages: ProviderChatMessage[];
    observer: {
      next: (event: ChatStreamEvent) => void;
      complete: () => void;
    };
    isActive: () => boolean;
    usageRecordId: string | undefined;
    quotaId: string | undefined;
    quotaReservedTokens: number;
    effectiveModel: Model;
  }): Promise<void> {
    const {
      conversationId,
      assistantMessageId,
      modelName,
      providerMessages,
      observer,
      isActive,
      usageRecordId,
      quotaId,
      quotaReservedTokens,
      effectiveModel,
    } = params;

    let fullResponse = '';
    let lastChunk: ProviderStreamChunk | undefined;

    const abortController = new AbortController();

    try {
      // Get the provider connection for the effective serving model.
      const connection =
        await this.runtime.assertReady(
          effectiveModel.id,
        );

      const stream = await this.runtime.stream(
        connection,
        {
          model: effectiveModel.actualName,
          messages: providerMessages,
        },
      );

      const state: StreamState = {
        fullResponse: '',
        subscribers: new Set([
          observer.next.bind(observer),
        ]),
        providerStream: stream,
        abortController,
        conversationId,
        assistantMessageId,
      };

      this.activeStreams.set(
        conversationId,
        state,
      );

      // Cancellation happened during setup, before the stream was registered.
      if (
        this.pendingCancels.delete(
          assistantMessageId,
        )
      ) {
        abortController.abort();

        this.broadcast(state, {
          type: 'error',
          data: {
            code: 'generation_cancelled',
            message: 'Generation was cancelled.',
          },
        });

        this.activeStreams.delete(
          conversationId,
        );

        return;
      }

      try {
        for await (const chunk of stream) {
          lastChunk = chunk;

          const delta =
            chunk.choices?.[0]?.delta?.content;

          if (!delta) {
            continue;
          }

          fullResponse += delta;
          state.fullResponse += delta;

          this.broadcast(state, {
            data: { delta },
          });
        }

        // Only a still-streaming row may become completed.
        const completed =
          await this.conversations.completeIfStreaming(
            assistantMessageId,
            fullResponse,
          );

        if (completed) {
          this.broadcast(state, {
            type: 'done',
            data: {},
          });
        } else {
          // Cancellation won the race.
          this.broadcast(state, {
            type: 'error',
            data: {
              code: 'generation_cancelled',
              message: 'Generation was cancelled.',
            },
          });
        }

        // ── finalize usage ───────────────────────────────────────────────

        if (usageRecordId) {
          const usage = lastChunk?.usage;

          await this.usage
            .finalize(usageRecordId, {
              promptTokens:
                usage?.prompt_tokens ?? 0,
              completionTokens:
                usage?.completion_tokens ?? 0,
              totalTokens:
                usage?.total_tokens ?? 0,
              inputPricePer1k:
                effectiveModel.inputPricePer1k,
              outputPricePer1k:
                effectiveModel.outputPricePer1k,
              status: 'completed',
            })
            .catch((err) => {
              this.logger.warn(
                `Failed to finalize usage: ${err}`,
              );
            });
        }

        // ── finalize quota ───────────────────────────────────────────────

        if (quotaId) {
          const totalTokens =
            lastChunk?.usage?.total_tokens ?? 0;

          await this.quotas
            .finalize(
              quotaId,
              quotaReservedTokens + totalTokens,
            )
            .catch((err) => {
              this.logger.warn(
                `Failed to finalize quota: ${err}`,
              );
            });
        }
      } finally {
        this.activeStreams.delete(
          conversationId,
        );
      }
    } catch (err) {
      this.pendingCancels.delete(
        assistantMessageId,
      );

      if (abortController.signal.aborted) {
        // User-initiated cancellation.
        this.logger.debug(
          `Provider stream aborted for message ${assistantMessageId}`,
        );
      } else {
        const status =
          typeof (err as { status?: number })?.status ===
          'number'
            ? (err as { status: number }).status
            : undefined;

        const upstream =
          err instanceof Error
            ? err.message
            : String(err);

        this.logger.error(
          `Provider stream error (status=${
            status ?? 'n/a'
          }, model=${modelName}): ${upstream}`,
        );

        if (isActive()) {
          observer.next({
            type: 'error',
            data: {
              code: 'provider_error',
              message: `The model provider returned an error${
                status
                  ? ` (HTTP ${status})`
                  : ''
              }: ${upstream}`,
            },
          });
        }

        await this.conversations
          .updateMessageStatus(
            assistantMessageId,
            'failed',
            fullResponse,
          )
          .catch((statusError) => {
            this.logger.warn(
              `Failed to mark message ${assistantMessageId} as failed: ${statusError}`,
            );
          });

        if (usageRecordId) {
          await this.usage
            .finalize(usageRecordId, {
              promptTokens: 0,
              completionTokens: 0,
              totalTokens: 0,
              inputPricePer1k:
                effectiveModel.inputPricePer1k,
              outputPricePer1k:
                effectiveModel.outputPricePer1k,
              status: 'failed',
            })
            .catch((usageError) => {
              this.logger.warn(
                `Failed to finalize failed usage: ${usageError}`,
              );
            });
        }

        if (quotaId) {
          await this.quotas
            .refund(
              quotaId,
              quotaReservedTokens,
            )
            .catch((quotaError) => {
              this.logger.warn(
                `Failed to refund quota: ${quotaError}`,
              );
            });
        }
      }
    } finally {
      observer.complete();
    }
  }

  /**
   * Retry a failed/cancelled assistant message.
   */
  private async runRetry(
    userId: string,
    conversationId: string,
    failedMessageId: string,
    observer: {
      next: (event: ChatStreamEvent) => void;
      complete: () => void;
    },
    isActive: () => boolean,
  ): Promise<void> {
    try {
      // ── resolve model ──────────────────────────────────────────────────

      const model =
        await this.models.resolveActiveModel({
          explicitModelId: null,
          userId,
        });

      if (!model) {
        return this.failStream(
          observer,
          isActive,
          'no_model_available',
          'No model is available. Ask an admin to set a default model or select one explicitly.',
        );
      }

      // ── provider readiness ─────────────────────────────────────────────

      try {
        await this.runtime.assertReady(model.id);
      } catch {
        return this.failStream(
          observer,
          isActive,
          'provider_not_configured',
          'Central provider is not configured. Ask an admin to set it up.',
        );
      }

      // ── validate conversation ──────────────────────────────────────────

      const conversation =
        await this.conversations.findById(
          conversationId,
        );

      if (!conversation) {
        return this.failStream(
          observer,
          isActive,
          'conversation_not_found',
          'Conversation not found.',
        );
      }

      if (conversation.userId !== userId) {
        return this.failStream(
          observer,
          isActive,
          'forbidden',
          'You do not own this conversation.',
        );
      }

      const targetMsg =
        conversation.messages.find(
          (message) =>
            message.id === failedMessageId,
        );

      if (!targetMsg) {
        return this.failStream(
          observer,
          isActive,
          'message_not_found',
          'The specified message does not belong to this conversation.',
        );
      }

      if (
        targetMsg.status !== 'failed' &&
        targetMsg.status !== 'cancelled'
      ) {
        return this.failStream(
          observer,
          isActive,
          'message_not_retryable',
          'Only failed or cancelled messages can be retried.',
        );
      }

      // One active generation per conversation.
      const existingStream =
        await this.conversations.findStreamingMessage(
          conversationId,
        );

      if (existingStream) {
        return this.failStream(
          observer,
          isActive,
          'generation_in_progress',
          'A generation is already in progress for this conversation. Wait for it to complete or cancel it.',
        );
      }

      // ── build provider history ─────────────────────────────────────────

      const priorTurns: ProviderChatMessage[] =
        conversation.messages
          .filter(
            (message) =>
              message.status !== 'failed' &&
              message.status !== 'cancelled',
          )
          .map((message) => ({
            role: message.role,
            content: message.content,
          }));

      const providerMessages: ProviderChatMessage[] = [...priorTurns];

      // ── create replacement assistant message ──────────────────────────

      const assistantMessage =
        await this.conversations.appendMessage(
          conversationId,
          '',
        );

      if (!assistantMessage) {
        return this.failStream(
          observer,
          isActive,
          'internal_error',
          'Failed to create assistant message.',
        );
      }

      const assistantMessageId =
        assistantMessage.id;

      await this.conversations.updateMessageStatus(
        assistantMessageId,
        'streaming',
      );

      observer.next({
        type: 'start',
        data: {
          conversationId,
          assistantMessageId,
        },
      });

      // Retry currently does not reserve quota or create a usage record,
      // preserving the behavior of the existing implementation.
      await this.consumeAndFinalize({
        conversationId,
        assistantMessageId,
        modelName: model.actualName,
        providerMessages,
        observer,
        isActive,
        usageRecordId: undefined,
        quotaId: undefined,
        quotaReservedTokens: 0,
        effectiveModel: model,
      });
    } catch (err) {
      this.logger.error(
        `Retry setup error: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`,
      );

      if (isActive()) {
        observer.next({
          type: 'error',
          data: {
            code: 'internal_error',
            message: 'An unexpected error occurred.',
          },
        });
      }

      observer.complete();
    }
  }

  /**
   * Account for a request that never reached a provider.
   */
  private async recordFailedUsage(params: {
    userId: string;
    conversationId: string;
    model: Model;
    attempts: number;
  }): Promise<void> {
    try {
      const record =
        await this.usage.create({
          userId: params.userId,
          conversationId: params.conversationId,
          modelId: params.model.id,
          providerId: params.model.providerId,
          attempts: params.attempts,
        });

      await this.usage.finalize(
        record.id,
        {
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          inputPricePer1k: 0,
          outputPricePer1k: 0,
          status: 'failed',
        },
      );
    } catch (err) {
      this.logger.warn(
        `Failed to record exhausted usage: ${
          err instanceof Error
            ? err.message
            : String(err)
        }`,
      );
    }
  }

  /**
   * Subscribe to an already-active stream.
   *
   * Sends accumulated content first, then registers the subscriber for
   * future tokens.
   */
  subscribeToActiveStream(
    conversationId: string,
    observer: {
      next: (event: ChatStreamEvent) => void;
    },
  ): boolean {
    const state =
      this.activeStreams.get(conversationId);

    if (!state) {
      return false;
    }

    if (state.fullResponse.length > 0) {
      observer.next({
        data: {
          delta: state.fullResponse,
        },
      });
    }

    state.subscribers.add(
      observer.next.bind(observer),
    );

    return true;
  }
}