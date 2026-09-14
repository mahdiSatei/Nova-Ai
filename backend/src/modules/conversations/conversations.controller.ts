import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';

/**
 * Conversation history endpoints for end users.
 *
 * All routes require authentication. Users can only access their
 * own conversations (403 on owner mismatch).
 */
@Controller('v1/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  /**
   * List the caller's conversations, most recently updated first.
   * Supports limit (default 20, max 100) and offset for pagination.
   */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ items: Array<{ id: string; modelId: string; title: string | null; createdAt: string; updatedAt: string }> }> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const conversations = await this.conversations.findByUser(
      user.id,
      parsedLimit,
      parsedOffset,
    );

    return {
      items: conversations.map((c) => ({
        id: c.id,
        modelId: c.modelId,
        title: c.title,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  }

  /**
   * Get a single conversation with its full message transcript.
   */
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ id: string; modelId: string; title: string | null; createdAt: string; updatedAt: string; messages: Array<{ id: string; role: string; content: string; createdAt: string }> }> {
    const conversation = await this.conversations.findById(id);

    if (!conversation) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }

    if (conversation.userId !== user.id) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'You do not have access to this conversation.',
      });
    }

    return {
      id: conversation.id,
      modelId: conversation.modelId,
      title: conversation.title,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      messages: conversation.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Delete a conversation (cascades messages in DB).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const deleted = await this.conversations.delete(id, user.id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }
  }
}
