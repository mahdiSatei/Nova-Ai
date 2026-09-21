import {
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ChatService, ChatStreamEvent } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { RetryRequestDto } from './dto/retry-request.dto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * SSE streaming chat controller.
 *
 * POST /v1/chat/stream accepts a JSON body and returns a
 * `text/event-stream` response. Each SSE event is one of:
 *
 *   - `data: {"delta":"..."}`  — token chunk from the model
 *   - `event: status`          — retry/failover progress (phase 6)
 *   - `event: done`            — stream completed successfully
 *   - `event: error`           — provider or internal error
 *
 * Note: Nest's SseStream serializes the event name from the `type`
 * property of each emitted object (`event` is dropped).
 */
/**
 * Map a typed ChatStreamEvent to the wire shape NestJS expects.
 *
 * NestJS's SseStream reads the event name from `type` on each emitted object.
 * The ChatStreamEvent union already uses `type` for this purpose, so we just
 * ensure the shape is a plain Record — no rewriting needed.
 */
function toSseMessage(e: ChatStreamEvent): Record<string, unknown> {
  return e as unknown as Record<string, unknown>;
}

@Controller('v1/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('stream')
  @Sse('text/event-stream')
  stream(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatRequestDto): Observable<Record<string, unknown>> {
    // Nest's SSE writer reads the event name from `message.type`; map the
    // service's `event` field so `event: done` / `error` / `status` frames
    // actually reach the wire.
    return this.chat
      .streamChat(user.id, dto)
      .pipe(map((e) => toSseMessage(e)));
  }

  /**
   * Resume an in-progress stream by subscribing to the active
   * provider stream held in memory. The client receives all
   * accumulated content as a single delta, then any new tokens.
   *
   * Returns 404 if no active stream exists for the conversation
   * (the generation has already completed or been cancelled).
   */
  @Post(':conversationId/resume')
  @Sse('text/event-stream')
  resume(@CurrentUser() user: AuthenticatedUser, @Param('conversationId') conversationId: string): Observable<Record<string, unknown>> {
    return new Observable<ChatStreamEvent>((observer) => {
      const subscribed = this.chat.subscribeToActiveStream(conversationId, observer);
      if (!subscribed) {
        observer.next({
          type: 'error',
          data: { code: 'no_active_stream', message: 'No active generation found for this conversation.' },
        });
        observer.complete();
      }
    }).pipe(map((e) => toSseMessage(e)));
  }

  /**
   * Cancel the active generation for a conversation.
   */
  @Post(':conversationId/cancel')
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ): Promise<{ messageId: string; status: string }> {
    const result = await this.chat.cancelGeneration(conversationId, user.id);
    if (!result) {
      throw new NotFoundException({
        code: 'no_active_generation',
        message: 'No active generation to cancel.',
      });
    }
    return { messageId: result.id, status: 'cancelled' };
  }

  /**
   * Retry a failed or cancelled generation as a live SSE stream.
   * Runs the same pipeline as /stream: start event, deltas, done/error.
   */
  @Post(':conversationId/retry')
  @Sse('text/event-stream')
  retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: RetryRequestDto,
  ): Observable<Record<string, unknown>> {
    return this.chat
      .retryGenerationStream(
        user.id,
        conversationId,
        dto.failedMessageId,
        dto.webSearch === true,
        dto.reasoning === true,
      )
      .pipe(map((e) => toSseMessage(e)));
  }
}