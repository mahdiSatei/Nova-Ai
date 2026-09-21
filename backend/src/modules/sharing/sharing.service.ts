import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConversationSnapshot } from './entities/conversation-snapshot.entity';
import { SnapshotMessage } from './entities/snapshot-message.entity';
import { ConversationsService } from '../conversations/conversations.service';
import { ModelsService } from '../models/models.service';

/**
 * Creates and reads immutable conversation snapshots for chat sharing.
 *
 * A snapshot freezes the conversation state at the moment of creation:
 * only completed/failed/cancelled messages are included (never streaming or
 * pending), and later messages added to the original conversation never
 * appear in an existing snapshot.
 */
@Injectable()
export class SharingService {
  private readonly logger = new Logger(SharingService.name);

  constructor(
    @InjectRepository(ConversationSnapshot)
    private readonly snapshotRepo: Repository<ConversationSnapshot>,
    @InjectRepository(SnapshotMessage)
    private readonly messageRepo: Repository<SnapshotMessage>,
    private readonly conversations: ConversationsService,
    private readonly models: ModelsService,
  ) {}

  /**
   * Create an immutable snapshot of a conversation.
   *
   * Only completed/failed/cancelled messages are included — streaming and
   * pending messages are excluded to avoid freezing incomplete content.
   */
  async createSnapshot(
    userId: string,
    conversationId: string,
  ): Promise<ConversationSnapshot> {
    const conversation = await this.conversations.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException({
        code: 'conversation_not_found',
        message: 'Conversation not found.',
      });
    }

    if (conversation.userId !== userId) {
      throw new ForbiddenException({
        code: 'forbidden',
        message: 'You do not own this conversation.',
      });
    }

    // Resolve model display name (model may have been deleted).
    let modelDisplayName: string | null = null;
    try {
      const model = await this.models.findById(conversation.modelId);
      modelDisplayName = model.displayName;
    } catch {
      this.logger.warn(
        `Could not resolve model ${conversation.modelId} for snapshot; recording id only.`,
      );
    }

    // Freeze messages: only terminal statuses.
    const frozenMessages = conversation.messages
      .filter(
        (m) =>
          m.status === 'completed' ||
          m.status === 'failed' ||
          m.status === 'cancelled',
      )
      .map((m) =>
        this.messageRepo.create({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.createdAt,
          citations: m.citations ?? [],
          reasoningSummary: m.reasoningSummary ?? null,
          fileSnapshot: m.file
            ? {
                id: m.file.id,
                originalName: m.file.originalName,
                mimeType: m.file.mimeType,
                size: m.file.size,
              }
            : null,
        }),
      );

    const snapshot = this.snapshotRepo.create({
      shareId: crypto.randomUUID(),
      ownerId: userId,
      title: conversation.title,
      modelId: conversation.modelId,
      modelDisplayName,
      messages: frozenMessages,
    });

    return this.snapshotRepo.save(snapshot);
  }

  /**
   * Find a snapshot by its public shareId. No authentication required.
   */
  async findByShareId(shareId: string): Promise<ConversationSnapshot> {
    const snapshot = await this.snapshotRepo.findOne({
      where: { shareId },
      relations: ['messages'],
    });

    if (!snapshot) {
      throw new NotFoundException({
        code: 'snapshot_not_found',
        message: 'Shared conversation not found.',
      });
    }

    return snapshot;
  }
}
