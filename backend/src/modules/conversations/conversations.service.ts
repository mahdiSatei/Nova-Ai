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

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
  ) {}

  async create(input: {
    userId: string;
    modelId: string;
    userMessage: string;
    fileId?: string | null;
  }): Promise<Conversation> {
    const conversation = this.conversationRepo.create({
      userId: input.userId,
      modelId: input.modelId,
      title: this.truncate(input.userMessage, 80),
    });

    const saved = await this.conversationRepo.save(conversation);

    // ذخیره پیام اول کاربر همراه با شناسه فایل پیوست
    await this.messageRepo.save(
      this.messageRepo.create({
        conversationId: saved.id,
        role: 'user',
        content: input.userMessage,
        fileId: input.fileId ?? null,
      }),
    );

    return this.conversationRepo.findOne({
      where: { id: saved.id },
      relations: ['messages', 'messages.file'],
    }) as Promise<Conversation>;
  }

  async appendUserMessage(
    conversationId: string,
    content: string,
    fileId?: string | null,
  ): Promise<Message> {
    const message = this.messageRepo.create({
      conversationId,
      role: 'user',
      content,
      fileId: fileId ?? null,
    });
    const saved = await this.messageRepo.save(message);
    await this.conversationRepo.update(conversationId, { updatedAt: new Date() });
    return saved;
  }

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
    await this.conversationRepo.update(conversationId, { updatedAt: new Date() });
    return saved;
  }

  async findById(id: string): Promise<Conversation | null> {
    return this.conversationRepo.findOne({
      where: { id },
      relations: ['messages', 'messages.file'],
      order: { messages: { createdAt: 'ASC' } },
    });
  }

  async findByUser(userId: string, limit = 20, offset = 0): Promise<Conversation[]> {
    return this.conversationRepo.find({
      where: { userId },
      order: { pinned: 'DESC', updatedAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

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

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) : s;
  }
}