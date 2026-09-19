import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ConversationsService } from './conversations.service';
import { ModelsService } from '../models/models.service';
import { ModelAccessService } from '../models/model-access.service';
import { Model } from '../models/entities/model.entity';
import { PinConversationDto } from './dto/pin-conversation.dto';
import { SetConversationModelDto } from './dto/set-conversation-model.dto';
import { Logger } from '@nestjs/common';
import type { CitationSource } from '../web-search/web-search.types';

/**
 * Conversation history endpoints for end users.
 *
 * All routes require authentication. Users can only access their
 * own conversations (403 on owner mismatch).
 */
@Controller('v1/conversations')
@UseGuards(JwtAuthGuard)
export class ConversationsController {
  private readonly logger = new Logger(ConversationsController.name);
  constructor(
    private readonly conversations: ConversationsService,
    private readonly models: ModelsService,
    private readonly access: ModelAccessService,
  ) {}

  /**
   * List the caller's conversations, pinned first and otherwise most
   * recently updated first. Supports limit (default 20, max 100) and
   * offset for pagination.
   */
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<{ items: Array<{ id: string; modelId: string; modelDisplayName: string | null; title: string | null; pinned: boolean; createdAt: string; updatedAt: string }> }> {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;

    const conversations = await this.conversations.findByUser(
      user.id,
      parsedLimit,
      parsedOffset,
    );

    const items = await Promise.all(conversations.map((c) => this.toSummary(c)));
    return { items };
  }

  /**
   * Get a single conversation with its full message transcript.
   */
  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ id: string; modelId: string; modelDisplayName: string | null; title: string | null; pinned: boolean; createdAt: string; updatedAt: string;    messages: Array<{ id: string; role: string; content: string; createdAt: string; status: string; citations: CitationSource[] }> }> {
    const conv = await this.conversations.findById(id);
    this.logger.debug(`ConversationsController.get: userId=${user.id}, conversationId=${id}, found=${!!conv}, messageCount=${conv?.messages.length ?? 0}`);
    if (!conv) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }

    if (conv.userId !== user.id) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'You do not have access to this conversation.',
      });
    }

    const summary = await this.toSummary(conv);
    return {
      ...summary,
      messages: conv.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        status: m.status,
        citations: m.citations ?? [],
      })),
    };
  }

  /**
   * Pin or unpin a conversation. Idempotent full-state replacement.
   */
  @Patch(':id/pin')
  async pin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PinConversationDto,
  ): Promise<{ id: string; pinned: boolean }> {
    const conversation = await this.conversations.setPinned(id, user.id, dto.pinned);
    if (!conversation) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }
    return { id: conversation.id, pinned: conversation.pinned };
  }

  /**
   * Switch the conversation's active model. The new modelId MUST
   * reference an enabled model; the response carries the updated
   * summary so the frontend can refresh its picker state.
   */
  @Patch(':id/model')
  async setModel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetConversationModelDto,
  ): Promise<{ id: string; modelId: string; modelDisplayName: string | null; title: string | null; pinned: boolean; createdAt: string; updatedAt: string }> {
    await this.requireUsableModel(user.id, dto.modelId);
    const updated = await this.conversations.setModel(id, user.id, dto.modelId);
    if (!updated) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }
    return this.toSummary(updated);
  }

  // ───────────────────────────── helpers ──────────────────────────────────

  /**
   * Resolve a client-supplied model id into "usable by this caller".
   *
   * Contract mapping (spec 003 §Acceptance criteria — "unauthorized model
   * requests are rejected server-side"):
   *   - unknown id  → 422 model_unavailable (never a 404: that would leak the
   *     difference between "no such model" and "not yours")
   *   - disabled    → 422 model_unavailable
   *   - unentitled  → 403 model_forbidden
   */
  private async requireUsableModel(userId: string, modelId: string): Promise<Model> {
    let model: Model | null = null;
    try {
      model = await this.models.findById(modelId);
    } catch (err) {
      if (!(err instanceof NotFoundException)) throw err;
    }
    if (!model) {
      throw new UnprocessableEntityException({
        code: 'model_unavailable',
        message: 'The selected model is not available.',
      });
    }
    await this.access.assertCanUseModel(userId, model);
    return model;
  }

  private async toSummary(c: {
    id: string;
    modelId: string;
    title: string | null;
    pinned: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): Promise<{
    id: string;
    modelId: string;
    modelDisplayName: string | null;
    title: string | null;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
  }> {
    const modelDisplayName = await this.models
      .findById(c.modelId)
      .then((m) => m.displayName)
      .catch((err) => {
        this.logger.warn(`Failed to resolve modelDisplayName for modelId=${c.modelId}: ${(err as Error).message}`);
        return null;
      });
    return {
      id: c.id,
      modelId: c.modelId,
      modelDisplayName,
      title: c.title,
      pinned: c.pinned,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
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
