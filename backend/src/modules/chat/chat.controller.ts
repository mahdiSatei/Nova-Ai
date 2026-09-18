import {
  Body,
  Controller,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ChatService, ChatStreamEvent } from './chat.service';
import { ChatRequestDto } from './dto/chat-request.dto';
import { Observable } from 'rxjs';

/**
 * SSE streaming chat controller.
 *
 * POST /v1/chat/stream accepts a JSON body and returns a
 * `text/event-stream` response. Each SSE event is one of:
 *
 *   - `data: {"delta":"..."}`  — token chunk from the model
 *   - `event: done`            — stream completed successfully
 *   - `event: error`           — provider or internal error
 */
@Controller('v1/chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Post('stream')
  @Sse('text/event-stream')
  stream(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChatRequestDto): Observable<ChatStreamEvent> {
    return this.chat.streamChat(user.id, dto);
  }
}
