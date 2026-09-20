
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
import { UsagePricingService } from '../billing/usage-pricing.service';
import { User } from '../users/entities/user.entity';
import { ChatRequestDto } from './dto/chat-request.dto';
import { FilesService } from '../files/files.service';
import { FileStatus } from '../files/entities/file.entity';
import { WebSearchService } from '../web-search/web-search.service';
import { WebSearchError } from '../web-search/web-search.errors';
import { WEB_SEARCH_LIMITS } from '../web-search/web-search.constants';
import type { CitationSource, WebSource } from '../web-search/web-search.types';
import { WalletService, roundCredits } from '../wallet/wallet.service';
import { AuditService } from '../audit/audit.service';
import {
  CREDIT_EXHAUSTION_GRACE_CREDITS,
  createCreditBudget,
  estimateOutputTokens,
} from './credit-budget';
import { ToolCallAccumulator } from './tool-call-accumulator';
import { buildCitations, extractCitationIds } from './citations';
import { ReasoningStreamNormalizer, ReasoningStreamEvent } from './reasoning-stream';
import { readStoredReasoningConfig, resolveReasoningConfig } from '../reasoning/reasoning.capability';
import type { ResolvedReasoningConfig } from '../reasoning/reasoning.types';
import type { ProviderReasoningRequest } from '../provider/adapters/provider-adapter.interface';
import type { CompletionReasoning } from '../conversations/conversations.service';
import {
  buildWebSearchToolOutput,
  WEB_SEARCH_SYSTEM_INSTRUCTION,
  WEB_SEARCH_TOOL,
  WEB_SEARCH_TOOL_NAME,
} from './web-search-prompt';

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

export type ChatStatusPhase =
  | 'retrying'
  | 'search_started'
  | 'search_completed'
  | 'retrieval_started'
  | 'retrieval_completed'
  | 'reasoning_started'
  | 'reasoning_completed'
  | 'answer_started'
  | 'generating';

export interface ChatStatusEvent {
  type: 'status';
  data: {
    phase: ChatStatusPhase;
    attempt?: number;
    maxAttempts?: number;
    query?: string;
    sources?: number;
    credits?: number;
  };
}

export interface ChatCitationsEvent {
  type: 'citations';
  data: { sources: CitationSource[] };
}

/**
 * One chunk of the provider's user-visible reasoning summary. Answer text keeps
 * using the untyped `message` frame; this is a separate, typed event so the
 * frontend can never confuse reasoning output with the answer.
 */
export interface ChatReasoningDeltaEvent {
  type: 'reasoning_delta';
  data: { delta: string };
}

export type ChatStreamEvent =
  | ChatDeltaEvent
  | ChatStartEvent
  | ChatDoneEvent
  | ChatErrorEvent
  | ChatStatusEvent
  | ChatCitationsEvent
  | ChatReasoningDeltaEvent;

/**
 * Holds the in-progress stream state for a conversation.
 */
interface StreamState {
  fullResponse: string;
  /** Accumulated user-visible reasoning summary, replayed to resuming clients. */
  reasoningSummary: string;
  subscribers: Set<(event: ChatStreamEvent) => void>;
  providerStream?: AsyncIterable<ProviderStreamChunk>;
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
    private readonly files: FilesService,

    @InjectRepository(User)
    private readonly userRepo: Repository<User>,

    private readonly usage: UsageService,
    private readonly pricing: UsagePricingService,
    private readonly failover: ProviderFailoverService,
    private readonly webSearch: WebSearchService,
    private readonly wallet: WalletService,
    private readonly audit: AuditService,
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
    webSearchEnabled = false,
    reasoningEnabled = false,
  ): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let cancelled = false;

      void this.runRetry(
        userId,
        conversationId,
        failedMessageId,
        webSearchEnabled,
        reasoningEnabled,
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

  /**
   * Map a normalized reasoning event onto the existing SSE protocol: the phase
   * transitions ride on the `status` family, and summary chunks use the typed
   * `reasoning_delta` event. Nothing is emitted for providers that expose no
   * reasoning output, because the normalizer produces no events for them.
   */
  private emitReasoningEvent(state: StreamState, event: ReasoningStreamEvent): void {
    if (event.kind === 'started') {
      this.broadcast(state, { type: 'status', data: { phase: 'reasoning_started' } });
      return;
    }
    if (event.kind === 'delta') {
      this.broadcast(state, { type: 'reasoning_delta', data: { delta: event.delta } });
      return;
    }
    this.broadcast(state, { type: 'status', data: { phase: 'reasoning_completed' } });
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

      // ── resolve attachment ─────────────────────────────────────────────
      // Validate the file before persisting the user message so a failed
      // attachment cannot leave an unusable message in the conversation.
      let finalUserContent = dto.message;
      let validFileId: string | null = null;

      if (dto.fileId && dto.fileId.trim().length > 0) {
        const file = await this.files.findOwned(dto.fileId, userId);

        if (!file) {
          return this.failStream(
            observer,
            isActive,
            'file_not_found',
            'Attached file was not found.',
          );
        }

        if (
          file.status === FileStatus.UPLOADED ||
          file.status === FileStatus.PROCESSING
        ) {
          return this.failStream(
            observer,
            isActive,
            'file_processing',
            'فایل هنوز در حال پردازش است. لطفاً چند لحظه بعد پیام را ارسال کنید.',
          );
        }

        if (file.status === FileStatus.FAILED) {
          return this.failStream(
            observer,
            isActive,
            'file_unreadable',
            file.errorMessage || 'پردازش فایل پیوست با خطا مواجه شد.',
          );
        }

        if (file.status === FileStatus.READY) {
          validFileId = file.id;

          if (file.extractedText) {
            const context =
              `[Attached file: ${file.originalName} (${file.mimeType})]\n` +
              `${file.extractedText}\n` +
              `[/Attached file]\n\n`;
            finalUserContent = `${context}${dto.message}`;
          }
        }
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

      const viewer = await this.access.loadViewer(userId);
      const isAdmin = viewer?.role === 'admin';

      // ── credit gate ─────────────────────────────────────────────────────
      // A paid model must not start a generation for an empty/overdrawn wallet.
      // Administrators are platform operators and use all enabled models free
      // of charge; their usage is still tracked for observability.

      // The bounded grace is intentionally only available after a user has a
      // positive balance; otherwise a new user could consume paid models for
      // free up to the grace limit.
      const modelRequiresCredits =
        Number(model.inputPricePer1m) > 0 || Number(model.outputPricePer1m) > 0;

      if (modelRequiresCredits && !isAdmin) {
        let balance: number;
        try {
          balance = await this.wallet.getBalance(userId);
        } catch (err) {
          this.logger.warn(`Failed to read wallet for user ${userId}: ${String(err)}`);
          return this.failStream(
            observer,
            isActive,
            'wallet_unavailable',
            'اعتبار حساب قابل بررسی نیست. لطفاً دوباره تلاش کنید.',
          );
        }

        if (balance <= 0) {
          return this.failStream(
            observer,
            isActive,
            'insufficient_credits',
            'برای استفاده از این مدل باید ابتدا اعتبار خود را شارژ کنید.',
          );
        }
      }

      // ── reasoning capability gate (Phase 8) ──────────────────
      // Explicit reasoning on a model that is not configured as reasoning-capable
      // is rejected, never silently downgraded.
      const reasoningRequested = dto.reasoning === true;

      if (reasoningRequested && this.reasoningConfigFor(model).supported !== true) {
        return this.failStream(
          observer,
          isActive,
          'reasoning_unsupported',
          'Reasoning is not supported by the selected model. Turn reasoning off and try again.',
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
          'The model provider is not available. Ask an admin to configure it.',
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
          validFileId,
        );
      } else {
        const conversation =
          await this.conversations.create({
            userId,
            modelId: model.id,
            userMessage: dto.message,
            fileId: validFileId,
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
          content: finalUserContent,
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

      // ── provider establishment ─────────────────────────────────────────

      let established: EstablishedStream;

      try {
        established = await this.failover.establish({
          model,
          messages: providerMessages,
          isAllowed: async (candidate) => {
            const entitled = await this.access.canAccessUser(
              userId,
              candidate,
            );
            // A fallback must be able to honour the reasoning request, otherwise
            // the turn would silently lose reasoning.
            return (
              entitled &&
              (!reasoningRequested || this.reasoningConfigFor(candidate).supported === true)
            );
          },
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
            messageId: assistantMessageId,
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

      await this.runToolLoop({
        userId,
        conversationId,
        assistantMessageId,
        modelName: effectiveModel.actualName,
        providerMessages,
        observer,
        isActive,
        usageRecordId,
        effectiveModel,
        isAdmin,
        webSearchEnabled: dto.webSearch === true,
        reasoning: reasoningRequested
          ? this.reasoningRequestFor(effectiveModel)
          : { enabled: false, summary: false },
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
   * Run the generation loop: open the provider stream, optionally execute
   * bounded web-search tool calls, then finalize the assistant message with
   * its content and citations. With web search disabled this performs exactly
   * one provider call — the pre-Phase-7 behaviour.
   */
  private async runToolLoop(params: {
    userId: string;
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
    effectiveModel: Model;
    isAdmin: boolean;
    webSearchEnabled: boolean;
    reasoning: ProviderReasoningRequest;
  }): Promise<void> {
    const {
      userId,
      conversationId,
      assistantMessageId,
      modelName,
      providerMessages,
      observer,
      isActive,
      usageRecordId,
      effectiveModel,
      isAdmin,
      webSearchEnabled,
      reasoning,
    } = params;

    let fullResponse = '';
    let providerUsage: ProviderStreamChunk['usage'] | undefined;
    let searchCredits = 0;

    let stopReason: 'completed' | 'credit_exhausted' = 'completed';

    const abortController = new AbortController();
    const sourcesByUrl = new Map<string, WebSource>();
    const startedAt = Date.now();

    this.logger.debug(
      `[web-search] runToolLoop — webSearchEnabled=${webSearchEnabled} ` +
        `userId="${userId}" modelName="${modelName}" ` +
        `providerTimeout=${effectiveModel.provider?.name ?? 'inline'}`,
    );

    // §3.8 boundary: balance at stream start + grace, checked against a
    // character-based estimate of answer + reasoning output. A rate of 0
    // (misconfigured pricing) disables the check.
    const outputCreditRate = await this.pricing
      .getOutputCreditRate(effectiveModel.id)
      .catch(() => 0);
    const budget =
      !isAdmin && outputCreditRate > 0
        ? createCreditBudget(
            (await this.wallet.getBalance(userId).catch(() => 0)) +
              CREDIT_EXHAUSTION_GRACE_CREDITS,
          )
        : null;
    const normalizer = new ReasoningStreamNormalizer({ enabled: reasoning.enabled });
    let answerStarted = false;

    try {
      // Get the provider connection for the effective serving model.
      const connection =
        await this.runtime.assertReady(
          effectiveModel.id,
        );

      const tools = webSearchEnabled ? [WEB_SEARCH_TOOL] : undefined;
      const messages: ProviderChatMessage[] = webSearchEnabled
        ? [
            { role: 'system', content: WEB_SEARCH_SYSTEM_INSTRUCTION },
            ...providerMessages,
          ]
        : [...providerMessages];

      const state: StreamState = {
        fullResponse: '',
        reasoningSummary: '',
        subscribers: new Set([
          observer.next.bind(observer),
        ]),
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
        const maxIterations = webSearchEnabled
          ? WEB_SEARCH_LIMITS.MAX_SEARCHES_PER_TURN
          : 0;

        let searchCount = 0;

        for (
          let iteration = 0;
          iteration <= maxIterations + 1;
          iteration++
        ) {
          const stream = await this.runtime.stream(
            connection,
            reasoning.enabled
              ? {
                  model: effectiveModel.actualName,
                  messages,
                  ...(tools ? { tools } : {}),
                  reasoning,
                }
              : tools
                ? {
                    model: effectiveModel.actualName,
                    messages,
                    tools,
                  }
                : {
                    model: effectiveModel.actualName,
                    messages,
                  },
            effectiveModel.preferredApiKeyId,
          );

          state.providerStream = stream;

          const accumulator = new ToolCallAccumulator();

          for await (const chunk of stream) {
            if (chunk.usage) providerUsage = chunk.usage;

            const delta = chunk.choices?.[0]?.delta;

            if (delta?.tool_calls?.length) {
              accumulator.push(delta.tool_calls);
            }

            for (const event of normalizer.pushReasoning(delta?.reasoning)) {
              if (event.kind === 'delta') state.reasoningSummary = normalizer.summary;
              this.emitReasoningEvent(state, event);
            }

            // §3.8: check after every chunk. The current chunk is not yet
            // accumulated; the conservative estimator absorbs that one-chunk
            // skew.
            if (
              budget &&
              budget.exceeded(
                estimateOutputTokens(
                  fullResponse.length + state.reasoningSummary.length,
                ) * outputCreditRate,
              )
            ) {
              stopReason = 'credit_exhausted';
              break;
            }

            if (!delta?.content) {
              continue;
            }

            for (const event of normalizer.onAnswerContent()) {
              this.emitReasoningEvent(state, event);
            }

            if (!answerStarted) {
              answerStarted = true;
              if (reasoning.enabled) {
                this.broadcast(state, {
                  type: 'status',
                  data: { phase: 'answer_started' },
                });
              }
            }

            fullResponse += delta.content;
            state.fullResponse += delta.content;

            this.broadcast(state, {
              data: { delta: delta.content },
            });
          }

          if (!webSearchEnabled || !accumulator.hasCalls) {
            break;
          }

          if (stopReason === 'credit_exhausted') {
            break;
          }

          const call = accumulator.calls.find(
            (candidate) =>
              candidate.function.name ===
              WEB_SEARCH_TOOL_NAME,
          );

          if (!call) {
            break;
          }

          let query = '';

          try {
            query = String(
              (
                JSON.parse(
                  call.function.arguments || '{}',
                ) as { query?: unknown }
              ).query ?? '',
            );
          } catch {
            query = '';
          }

          if (!query.trim()) {
            break;
          }

          messages.push({
            role: 'assistant',
            content: '',
            toolCalls: accumulator.calls,
          });

          if (
            searchCount >=
            WEB_SEARCH_LIMITS.MAX_SEARCHES_PER_TURN
          ) {
            messages.push({
              role: 'tool',
              content:
                'Web search limit reached for this turn. Answer using the information already gathered.',
              toolCallId: call.id,
            });
            continue;
          }

          searchCount++;

          this.broadcast(state, {
            type: 'status',
            data: { phase: 'search_started', query },
          });

          const elapsedSinceTurnStart = Date.now() - startedAt;
          const remainingMs =
            WEB_SEARCH_LIMITS.MAX_TOTAL_SEARCH_MS - elapsedSinceTurnStart;

          this.logger.debug(
            `[web-search] Search #${searchCount + 1} for query="${query}" ` +
              `elapsedSinceTurnStart=${elapsedSinceTurnStart}ms remainingMs=${remainingMs}ms`,
          );

          let toolOutput: string;

          if (remainingMs <= 0) {
            this.logger.warn(
              `[web-search] Time budget exhausted — remainingMs=${remainingMs} ` +
                `elapsedSinceTurnStart=${elapsedSinceTurnStart}ms searchCount=${searchCount}`,
            );
            this.broadcast(state, {
              type: 'status',
              data: {
                phase: 'search_completed',
                query,
                sources: 0,
                credits: 0,
              },
            });

            toolOutput =
              'Web search was skipped: the time budget for this turn was exhausted. Answer from what you already know.';
          } else {
            try {
              const searchTimeoutMs = Math.min(
                WEB_SEARCH_LIMITS.SEARCH_TIMEOUT_MS,
                remainingMs,
              );
              this.logger.debug(
                `[web-search] Calling webSearch.search() — ` +
                  `timeoutMs=${searchTimeoutMs} query="${query}" startIndex=${sourcesByUrl.size + 1}`,
              );
              const outcome =
                await this.webSearch.search({
                  query,
                  startIndex:
                    sourcesByUrl.size + 1,
                  timeoutMs: searchTimeoutMs,
                  signal: abortController.signal,
                });

              this.logger.debug(
                `[web-search] Search completed successfully — sources=${outcome.sources.length} ` +
                  `empty=${outcome.empty} query="${outcome.query}"`,
              );

              // §4.1/§4.2: one fixed, deployment-configured price per
              // *successful* search — never a function of result count,
              // extracted content, or provider cost. A discrete charge uses the
              // strict deduction (no mid-stream grace). Pricing of 0 disables
              // search billing rather than charging nothing-but-touching-wallet.
              const searchCost = isAdmin ? 0 : this.pricing.calculateWebSearchCost();
              searchCredits += searchCost;

              if (searchCost > 0) {
                try {
                  await this.wallet.deductCredits(userId, searchCost);
                } catch (err) {
                  // The search was already served to the model; record no charge
                  // we did not collect and keep the turn alive (§3.9).
                  this.logger.warn(
                    `Failed to deduct ${searchCost} search credits for user ${userId}: ${String(err)}`,
                  );
                }
              }

              const added: WebSource[] = [];

              for (const source of outcome.sources) {
                if (
                  sourcesByUrl.size >=
                  WEB_SEARCH_LIMITS.MAX_SOURCES_PER_TURN
                ) {
                  break;
                }
                if (sourcesByUrl.has(source.url)) {
                  continue;
                }
                sourcesByUrl.set(source.url, source);
                added.push(source);
              }

              this.broadcast(state, {
                type: 'status',
                data: {
                  phase: 'search_completed',
                  query,
                  sources: outcome.sources.length,
                  credits: searchCost,
                },
              });

              this.broadcast(state, {
                type: 'status',
                data: {
                  phase: 'retrieval_started',
                  query,
                  sources: added.length,
                },
              });

              toolOutput = buildWebSearchToolOutput(
                outcome,
                added,
              );

              this.broadcast(state, {
                type: 'status',
                data: {
                  phase: 'retrieval_completed',
                  query,
                  sources: added.length,
                },
              });
            } catch (searchErr) {
              const searchError =
                searchErr instanceof WebSearchError
                  ? searchErr
                  : new WebSearchError(
                      'web_search_provider_error',
                      'Web search failed.',
                    );

              this.logger.warn(
                `Web search failed (${searchError.code}): ${searchError.message}`,
              );

              this.broadcast(state, {
                type: 'status',
                data: {
                  phase: 'search_completed',
                  query,
                  sources: 0,
                  credits: 0,
                },
              });

              toolOutput = `Web search failed (${searchError.code}). Answer without web results and tell the user the search was unavailable.`;
            }
          }

          messages.push({
            role: 'tool',
            content: toolOutput,
            toolCallId: call.id,
          });
        }

        // Close an open reasoning block even when the answer produced no text.
        for (const event of normalizer.finish()) {
          this.emitReasoningEvent(state, event);
        }

        if (webSearchEnabled) {
          this.broadcast(state, {
            type: 'status',
            data: { phase: 'generating' },
          });
        }

        const citations = buildCitations(
          [...sourcesByUrl.values()],
          extractCitationIds(fullResponse),
        );

        const reasoningCompletion: CompletionReasoning = {
          enabled: reasoning.enabled,
          // Only a summary the provider actually exposed is persisted; a failed or
          // cancelled generation never reaches this line.
          summary: reasoning.enabled ? normalizer.userVisibleSummary : null,
        };

        // Only a still-streaming row may become completed.
        const completed =
          await this.conversations.completeIfStreaming(
            assistantMessageId,
            fullResponse,
            citations,
            reasoningCompletion,
          );

        if (completed) {
          if (citations.length > 0) {
            this.broadcast(state, {
              type: 'citations',
              data: { sources: citations },
            });
          }

          if (stopReason === 'credit_exhausted') {
            // §3.8 notify: the partial answer is saved (status completed) and
            // the stream ends with the dedicated terminal code instead of done.
            this.broadcast(state, {
              type: 'error',
              data: {
                code: 'credit_exhausted',
                message:
                  'You ran out of credits mid-response. The partial answer has been saved; top up your wallet to continue.',
              },
            });
          } else {
            this.broadcast(state, {
              type: 'done',
              data: {},
            });
          }
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
          await this.finalizeTurnUsage({
            usageRecordId,
            userId,
            modelId: effectiveModel.id,
            usage: providerUsage,
            answerChars: fullResponse.length,
            reasoningChars: state.reasoningSummary.length,
            exhausted: stopReason === 'credit_exhausted',
            capCredits: budget ? budget.boundaryCredits : null,
            searchCredits,
            assistantMessageId,
            isAdmin,
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
            .finalizeOnce(usageRecordId, {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              reasoningTokens: 0,
              chargedCost: 0,
              chargedCredits: 0,
              status: 'failed',
              searchCredits,
            })
            .catch((usageError) => {
              this.logger.warn(
                `Failed to finalize failed usage: ${usageError}`,
              );
            });
        }
      }
    } finally {
      observer.complete();
    }
  }

  /**
   * Price, deduct, and record the charge for one finished generation (spec
   * Phase 3 §3.1, §3.3, §3.9).
   *
   * Ordering: the wallet deduction happens first, then the usage record is
   * claimed with `finalizeOnce`. If the record was already claimed, the
   * deduction is refunded — a duplicate finalization can never charge twice.
   * `capCredits` (the §3.8 boundary, wired in a later task) limits what the
   * turn may cost regardless of what the provider reported; `null` is
   * uncapped. On a mid-stream exhaustion stop the provider never sends final
   * usage, so tokens are estimated from the accumulated text (input unknown,
   * recorded as 0).
   */
  private async finalizeTurnUsage(params: {
    usageRecordId: string | undefined;
    userId: string;
    modelId: string;
    usage: ProviderStreamChunk['usage'];
    answerChars: number;
    reasoningChars: number;
    exhausted: boolean;
    capCredits: number | null;
    searchCredits: number;
    assistantMessageId: string;
    isAdmin: boolean;
  }): Promise<void> {
    const { usageRecordId, userId, modelId, usage } = params;

    const inputTokens = params.exhausted ? 0 : (usage?.prompt_tokens ?? 0);
    const outputTokens = params.exhausted
      ? estimateOutputTokens(params.answerChars)
      : (usage?.completion_tokens ?? 0);
    const reasoningTokens = params.exhausted
      ? estimateOutputTokens(params.reasoningChars)
      : (usage?.reasoning_tokens ??
        usage?.completion_tokens_details?.reasoning_tokens ??
        0);
    const totalTokens = params.exhausted
      ? outputTokens + reasoningTokens
      : (usage?.total_tokens ?? 0);

    const cost = await this.pricing
      .calculateLlmCost(modelId, inputTokens, outputTokens, reasoningTokens)
      .catch((err) => {
        this.logger.warn(
          `Failed to price usage for message ${params.assistantMessageId}: ${String(err)}`,
        );
        return { chargedCost: 0, chargedCredits: 0 };
      });

    const chargeable = params.isAdmin
      ? 0
      : params.capCredits === null
        ? cost.chargedCredits
        : Math.min(cost.chargedCredits, params.capCredits);
    const charge = roundCredits(chargeable);

    let deducted = 0;
    if (charge > 0) {
      try {
        await this.wallet.deductCreditsWithGrace(
          userId,
          charge,
          CREDIT_EXHAUSTION_GRACE_CREDITS,
        );
        deducted = charge;
        void this.audit.log({
          actorId: userId,
          action: 'credit_deducted',
          targetType: 'wallet',
          metadata: { amount: charge, modelId, conversationId: params.assistantMessageId },
        });
      } catch (err) {
        // Boundary lost to a concurrent stream, or wallet failure: record no
        // charge we did not collect (§3.9). The turn stays recoverable.
        this.logger.warn(
          `Failed to deduct ${charge} credits for message ${params.assistantMessageId}: ${String(err)}`,
        );
      }
    }

    if (!usageRecordId) return;

    const recorded = await this.usage
      .finalizeOnce(usageRecordId, {
        inputTokens,
        outputTokens,
        totalTokens,
        reasoningTokens,
        chargedCost: params.isAdmin ? 0 : cost.chargedCost,
        chargedCredits: deducted,
        status: 'completed',
        searchCredits: params.searchCredits,
      })
      .catch((err) => {
        this.logger.warn(
          `Failed to finalize usage for message ${params.assistantMessageId}: ${String(err)}`,
        );
        return false;
      });

    if (!recorded && deducted > 0) {
      // Another finalization already claimed this record; give the credits back.
      await this.wallet.grantCredits(userId, deducted).catch((err) => {
        this.logger.error(
          `Failed to refund ${deducted} credits for message ${params.assistantMessageId}: ${String(err)}`,
        );
      });
    }
  }

  /**
   * Retry a failed/cancelled assistant message.
   */
  private async runRetry(
    userId: string,
    conversationId: string,
    failedMessageId: string,
    webSearchEnabled: boolean,
    reasoningEnabled: boolean,
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

      // ── reasoning capability gate (Phase 8) ────────────────────────────
      if (reasoningEnabled && this.reasoningConfigFor(model).supported !== true) {
        return this.failStream(
          observer,
          isActive,
          'reasoning_unsupported',
          'Reasoning is not supported by the selected model. Turn reasoning off and try again.',
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
          'The model provider is not available. Ask an admin to configure it.',
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

      // Regeneration is a new generation: new usage identity, new charge (§3.6).
      let usageRecordId: string | undefined;
      try {
        const usageRecord = await this.usage.create({
          userId,
          conversationId,
          modelId: model.id,
          providerId: model.providerId,
          attempts: 1,
          messageId: assistantMessageId,
        });
        usageRecordId = usageRecord.id;
      } catch (err) {
        this.logger.warn(
          `Failed to create retry usage record: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      await this.runToolLoop({
        userId,
        conversationId,
        assistantMessageId,
        modelName: model.actualName,
        providerMessages,
        observer,
        isActive,
        usageRecordId,
        effectiveModel: model,
        isAdmin: (await this.access.loadViewer(userId))?.role === 'admin',
        webSearchEnabled,
        reasoning: reasoningEnabled
          ? this.reasoningRequestFor(model)
          : { enabled: false, summary: false },
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
   * The effective reasoning configuration for a model. Deterministic for any
   * stored value (see resolveReasoningConfig) and provider-independent.
   */
  private reasoningConfigFor(model: Model): ResolvedReasoningConfig {
    return resolveReasoningConfig(readStoredReasoningConfig(model.reasoningConfig));
  }

  /** The normalized provider request for a reasoning-enabled turn. */
  private reasoningRequestFor(model: Model): ProviderReasoningRequest {
    const config = this.reasoningConfigFor(model);
    return { enabled: config.supported === true, summary: config.output === 'summary' };
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

      await this.usage.finalizeOnce(
        record.id,
        {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          reasoningTokens: 0,
          chargedCost: 0,
          chargedCredits: 0,
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

    if (state.reasoningSummary.length > 0) {
      observer.next({
        type: 'reasoning_delta',
        data: { delta: state.reasoningSummary },
      });
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
