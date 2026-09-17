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

  // ─────────────────────────── helpers ────────────────────────────────────

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) : s;
  }
}
