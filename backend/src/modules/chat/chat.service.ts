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
import { FilesService } from '../files/files.service';
import { FileContentService, FileParseError } from '../files/file-content.service';
import { FileStatus } from '../files/entities/file.entity';

/**
 * Event shapes emitted on the SSE stream.
 *
 * NOTE: the wire property is `type` — Nest's SseStream serializes
 * `type` into the SSE `event:` field; an `event` property would be
 * silently dropped.
 */
export interface ChatDeltaEvent {
  data: { delta: string };
}

export interface ChatDoneEvent {
  type: 'done';
  data: Record<string, never>;
}

export interface ChatErrorEvent {
  type: 'error';
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
    private readonly files: FilesService,
    private readonly fileContent: FileContentService,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Stream a chat completion as an RxJS Observable of SSE events.
   *
   * The controller returns this Observable synchronously to the
   * `@Sse()` decorator. All async setup (model resolution, provider
   * check, conversation creation) and the consume-and-persist loop run
   * inside `runStream`, which is launched as a detached background
   * task via `void runStream(...)`.
   *
   * **Disconnect resilience**: when the client unsubscribes (browser
   * closed, network dropped, refresh), the RxJS teardown flips
   * `clientConnected` to false. From that point on, `runStream` stops
   * forwarding events to the observer (its socket is gone — we must
   * not write to it), but it keeps consuming the provider stream and
   * persists the FULL assistant response via
   * `ConversationsService.appendMessage` once the consume loop exits
   * for any reason (normal completion, provider error, or stream end).
   *
   * The user can read the persisted message via `GET /v1/conversations/:id`
   * after the response is complete.
   */
  streamChat(userId: string, dto: ChatRequestDto): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      let clientConnected = true;

      // Kick off the detached consume-and-persist task. It runs to
      // completion regardless of whether anyone is still subscribed.
      void this.runStream(userId, dto, observer, () => clientConnected);

      // Teardown: when the client disconnects (or the Observable is
      // unsubscribed for any other reason), mark the client as gone.
      // The consume loop will continue running and persist the full
      // response, but will skip writing SSE events to the closed socket.
      return () => {
        clientConnected = false;
      };
    });
  }

  // ─────────────────────────────── private ─────────────────────────────────

  private async updateUserLastSelectedModel(userId: string, modelId: string): Promise<void> {
    await this.userRepo.update({ id: userId }, { lastSelectedModelId: modelId });
  }

  /**
   * Background task that owns the consume-and-persist flow.
   *
   * Persistence contract: in the inner `finally` block, whatever
   * assistant text was accumulated into `fullResponse` is appended to
   * the conversation via `ConversationsService.appendMessage` — even
   * if the client has long since disconnected. An empty `fullResponse`
   * (zero tokens observed before the stream ended) is NOT persisted.
   *
   * The `isClientConnected` callback guards every `observer.next(...)`
   * call so we never write to a closed SSE socket.
   */
  private async runStream(
    userId: string,
    dto: ChatRequestDto,
    observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
    isClientConnected: () => boolean,
  ): Promise<void> {
    let conversationId: string | undefined;
    let fullResponse = '';

    try {
      // ── setup phase ─────────────────────────────────────────────────
      // 1. Resolve the active model.
      const model = await this.models.resolveActiveModel({
        explicitModelId: dto.modelId ?? null,
        userId,
      });
      if (!model) {
        if (isClientConnected()) {
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

      // 2. Verify central provider is configured.
      try {
        await this.providerClient.getClient();
      } catch {
        if (isClientConnected()) {
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

      // 3. Validate message length (FR-014).
      if (dto.message.length < 1 || dto.message.length > 32000) {
        if (isClientConnected()) {
          observer.next({
            type: 'error',
            data: { code: 'invalid_message', message: 'Message must be 1..32000 characters.' },
          });
        }
        observer.complete();
        return;
      }

      // 4. Resolve the attachment before any persistence (Async Queue / Phase 3)
      let finalUserContent = dto.message;
      let validFileId: string | null = null;

      if (dto.fileId && dto.fileId.trim().length > 0) {
        const file = await this.files.findOwned(dto.fileId, userId);
        if (!file) {
          if (isClientConnected()) {
            observer.next({
              type: 'error',
              data: {
                code: 'file_not_found',
                message: 'Attached file was not found.',
              },
            });
          }
          observer.complete();
          return;
        }

        // بررسی اینکه آیا فایل در صف در حال پردازش است
        if (file.status === FileStatus.UPLOADED || file.status === FileStatus.PROCESSING) {
          if (isClientConnected()) {
            observer.next({
              type: 'error',
              data: {
                code: 'file_processing',
                message: 'فایل هنوز در حال پردازش است. لطفاً چند لحظه بعد پیام را ارسال کنید.',
              },
            });
          }
          observer.complete();
          return;
        }

        // بررسی خطای پردازش فایل
        if (file.status === FileStatus.FAILED) {
          if (isClientConnected()) {
            observer.next({
              type: 'error',
              data: {
                code: 'file_unreadable',
                message: file.errorMessage || 'پردازش فایل پیوست با خطا مواجه شد.',
              },
            });
          }
          observer.complete();
          return;
        }

        // فایل با موفقیت در ورکر پردازش شده و آماده است
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

      // 5. Resolve or create conversation.
      let priorTurns: ChatMessage[];
      if (dto.conversationId) {
        const existing = await this.conversations.findById(dto.conversationId);
        if (!existing) {
          if (isClientConnected()) {
            observer.next({
              type: 'error',
              data: { code: 'conversation_not_found', message: 'Conversation not found.' },
            });
          }
          observer.complete();
          return;
        }
        conversationId = existing.id;
        priorTurns = existing.messages.map(
          (m) => ({ role: m.role as ChatMessage['role'], content: m.content }),
        );
        // ذخیره پیام جدید کاربر در گفتگوی موجود همراه با شناسه فایل
        await this.conversations.appendUserMessage(existing.id, dto.message, validFileId);
      } else {
        const conv = await this.conversations.create({
          userId,
          modelId: model.id,
          userMessage: dto.message,
          fileId: validFileId,
        });
        conversationId = conv.id;
        priorTurns = [];
      }

      // 6. Persist sticky model choice (fire-and-forget).
      this.updateUserLastSelectedModel(userId, model.id).catch(() => {
        this.logger.warn(`Failed to update lastSelectedModelId for user ${userId}`);
      });

      // 7. Build the messages array for the provider (FR-015).
      const providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        ...priorTurns,
        { role: 'user', content: finalUserContent },
      ];

      // ── consume phase ───────────────────────────────────────────────
      try {
        const stream = await this.providerClient.stream({
          model: model.actualName,
          messages: providerMessages,
        });

        for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            fullResponse += delta;
            if (isClientConnected()) {
              observer.next({ data: { delta } });
            }
          }
        }

        if (isClientConnected()) {
          observer.next({ type: 'done', data: {} });
        }
      } catch (err) {
        this.logger.error(
          `Provider stream error: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (isClientConnected()) {
          observer.next({
            type: 'error',
            data: {
              code: 'provider_error',
              message: 'The model provider returned an error.',
            },
          });
        }
      } finally {
        // پایداری پیام پاسخ حتی در صورت قطعی کاربر
        if (fullResponse && conversationId) {
          await this.conversations.appendMessage(conversationId, fullResponse);
        }
        observer.complete();
      }
    } catch (err) {
      this.logger.error(
        `Chat setup error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isClientConnected()) {
        observer.next({
          type: 'error',
          data: { code: 'internal_error', message: 'An unexpected error occurred.' },
        });
      }
      observer.complete();
    }
  }
}
