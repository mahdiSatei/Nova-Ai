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
 * Nest's SSE writer emits the event name from `message.type`, while the
 * service's event objects use `event`. The map below bridges the two so the
 * wire format actually carries `event: done` / `event: error` /
 * `event: status` frames.
 */
function toSseMessage(e: ChatStreamEvent): Record<string, unknown> {
  const source = e as unknown as { event?: string } & Record<string, unknown>;
  const { event, ...rest } = source;
  return { ...rest, type: event };
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
  resume(@CurrentUser() user: AuthenticatedUser, @Param('conversationId') conversationId: string): Observable<ChatStreamEvent> {
    return new Observable<ChatStreamEvent>((observer) => {
      const subscribed = this.chat.subscribeToActiveStream(conversationId, observer);
      if (!subscribed) {
        observer.next({
          event: 'error',
          data: { code: 'no_active_stream', message: 'No active generation found for this conversation.' },
        });
        observer.complete();
      }
    });
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
   * Retry a failed or cancelled generation.
   */
  @Post(':conversationId/retry')
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: { failedMessageId: string },
  ): Promise<{ messageId: string; status: string }> {
    const result = await this.chat.retryGeneration(conversationId, dto.failedMessageId, user.id);
    if (!result) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }
    return { messageId: result.id, status: 'streaming' };
  }
}
