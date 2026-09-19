import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { MessageStatus } from './conversations.types';

/**
 * Persistent ConversationsService backed by TypeORM.
 *
 * Replaces the in-memory stub from T005. The method signatures are
 * intentionally the same so ChatService (T005) and the controller
 * (T006) can consume this without changes.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  /**
   * Create a new conversation with the initial user message.
   * The title defaults to the first user message truncated to 80 chars.
   */
  async create(input: {
    userId: string;
    modelId: string;
    userMessage: string;
  }): Promise<Conversation> {
    const conversation = this.conversationRepo.create({
      userId: input.userId,
      modelId: input.modelId,
      title: this.truncate(input.userMessage, 80),
    });

    const saved = await this.conversationRepo.save(conversation);

    // Persist the first user message.
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: saved.id,
        role: 'user',
        content: input.userMessage,
      }),
    );

    // Reload with messages for the caller.
    return this.conversationRepo.findOne({
      where: { id: saved.id },
      relations: ['messages'],
    }) as Promise<Conversation>;
  }

  /**
   * Append a user message to an existing conversation.
   * Used for turns after the first (the first user message is persisted
   * by `create`). Returns the created message, or undefined if the
   * conversation does not exist (caller should treat this as a no-op).
   */
  async appendUserMessage(conversationId: string, content: string): Promise<Message | undefined> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) return undefined;

    const message = this.messageRepo.create({
      conversationId,
      role: 'user',
      content,
    });
    const saved = await this.messageRepo.save(message);

    // Bump the conversation's updatedAt.
    await this.conversationRepo.update(conversationId, { updatedAt: new Date() });

    return saved;
  }

  /**
   * Append the assistant's response to an existing conversation.
   * Returns the created message, or undefined if the conversation
   * does not exist (caller should treat this as a no-op).
   */
  async appendMessage(conversationId: string, content: string): Promise<Message | undefined> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId },
    });
    if (!conversation) return undefined;

    const message = this.messageRepo.create({
      conversationId,
      role: 'assistant',
      content,
    });
    const saved = await this.messageRepo.save(message);

    // Bump the conversation's updatedAt.
    await this.conversationRepo.update(conversationId, { updatedAt: new Date() });

    return saved;
  }

  /**
   * Find a conversation by id with its messages ordered by createdAt asc.
   * Returns null if not found.
   */
  async findById(id: string): Promise<Conversation | null> {
    return this.conversationRepo.findOne({
      where: { id },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });
  }

  /**
   * List conversations for a user, pinned first and otherwise ordered
   * by most recent activity (updatedAt desc). Supports limit/offset
   * for pagination.
   */
  async findByUser(userId: string, limit = 20, offset = 0): Promise<Conversation[]> {
    return this.conversationRepo.find({
      where: { userId },
      order: { pinned: 'DESC', updatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Pin or unpin a conversation. Returns the updated conversation, or
   * null if it does not exist. Throws ForbiddenException when the
   * requester is not the owner.
   */
  async setPinned(
    id: string,
    requesterId: string,
    pinned: boolean,
  ): Promise<Conversation | null> {
    const conversation = await this.conversationRepo.findOne({
      where: { id },
      select: ['id', 'userId'],
    });

    if (!conversation) return null;
    if (conversation.userId !== requesterId) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'You do not own this conversation.',
      });
    }

    await this.conversationRepo.update(id, { pinned });
    return { ...conversation, pinned };
  }

  /**
   * Delete a conversation by id. Returns true if it existed, false
   * otherwise. Messages are cascade-deleted by the DB.
   */
  async delete(id: string, requesterId: string): Promise<boolean> {
    const conversation = await this.conversationRepo.findOne({
      where: { id },
      select: ['id', 'userId'],
    });

    if (!conversation) return false;
    if (conversation.userId !== requesterId) {
      throw new ConflictException({
        code: 'forbidden',
        message: 'You do not own this conversation.',
      });
    }

    await this.conversationRepo.delete(id);
    return true;
  }

  // ─── streaming message methods ──────────────────────────────────────────

  /**
   * Find the assistant message with status 'streaming' for a conversation.
   * Returns null if no streaming message exists (allows one active generation).
   */
  async findStreamingMessage(conversationId: string): Promise<Message | null> {
    return this.messageRepo.findOne({
      where: { conversationId, status: 'streaming' as MessageStatus },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Atomically mark a streaming message as completed with its full
   * content. The update only applies while the row is still
   * 'streaming', so a concurrent cancel can never be overwritten:
   * returns false when the row was not in 'streaming' state (nothing
   * was written).
   */
  async completeIfStreaming(messageId: string, content: string): Promise<boolean> {
    const result = await this.messageRepo.update(
      { id: messageId, status: 'streaming' as MessageStatus },
      { status: 'completed' as MessageStatus, content },
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Update a message's status, and optionally its content.
   * Returns the updated message or null if not found.
   */
  async updateMessageStatus(
    messageId: string,
    status: MessageStatus,
    content?: string,
  ): Promise<Message | null> {
    const patch: Record<string, string | undefined> = { status };
    if (content !== undefined) {
      patch.content = content;
    }
    await this.messageRepo.update(messageId, patch);
    return this.messageRepo.findOne({ where: { id: messageId } });
  }

  /**
   * Update the content of an assistant message that is currently streaming.
   * Used to persist partial content during streaming.
   * @param conversationId The conversation ID
   * @param assistantMessageId The assistant message ID
   * @param content The new content to set
   */
  async updateAssistantMessageContent(
    conversationId: string,
    assistantMessageId: string,
    content: string,
  ): Promise<void> {
    await this.messageRepo.update(
      { id: assistantMessageId, conversationId, status: 'streaming' as MessageStatus },
      { content },
    );
    // Note: We do not check the result because if the message is no longer streaming,
    // the update will be ignored (no rows affected) and the stream will be finalized soon.
  }

  /**
   * Find a message by id with its conversation relation.
   * Used for ownership checks before mutations.
   */
  async findMessageById(messageId: string): Promise<(Message & { conversation: Conversation }) | null> {
    return this.messageRepo.findOne({
      where: { id: messageId },
      relations: ['conversation'],
    }) as Promise<(Message & { conversation: Conversation }) | null>;
  }

  /**
   * Cancel an active (streaming) generation.
   * Validates: the message exists, is streaming, and the requester owns the conversation.
   */
  async cancelGeneration(
    conversationId: string,
    messageId: string,
    requesterId: string,
  ): Promise<Message | null> {
    const streaming = await this.messageRepo.findOne({
      where: { id: messageId, conversationId, status: 'streaming' as MessageStatus },
    });
    if (!streaming) {
      throw new ConflictException({
        code: 'no_active_generation',
        message: 'No active generation to cancel.',
      });
    }

    const msgWithConv = await this.findMessageById(messageId);
    if (!msgWithConv || msgWithConv.conversation.userId !== requesterId) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'You do not own this conversation.',
      });
    }

    await this.messageRepo.update(messageId, { status: 'cancelled' as MessageStatus });
    return this.messageRepo.findOne({ where: { id: messageId } });
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) : s;
  }
}
