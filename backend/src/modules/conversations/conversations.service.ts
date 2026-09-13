import { Injectable } from '@nestjs/common';
import { ConversationRecord, MessageRecord } from './conversations.types';

/**
 * In-memory ConversationsService stub for T005.
 *
 * ChatService uses this to persist user/assistant message pairs during
 * the streaming-chat task. T006 (US4) replaces this with a persistent
 * TypeORM-backed implementation that exposes the same method signatures.
 */
@Injectable()
export class ConversationsService {
  private readonly conversations = new Map<string, ConversationRecord>();

  /**
   * Create a new conversation with the initial user message.
   * Returns the created conversation record.
   */
  create(input: {
    userId: string;
    modelId: string;
    userMessage: string;
  }): ConversationRecord {
    const id = this.uuid();
    const now = new Date();
    const title = this.truncate(input.userMessage, 80);

    const conv: ConversationRecord = {
      id,
      userId: input.userId,
      modelId: input.modelId,
      title,
      createdAt: now,
      updatedAt: now,
      messages: [
        {
          id: this.uuid(),
          conversationId: id,
          role: 'user',
          content: input.userMessage,
          createdAt: now,
        },
      ],
    };

    this.conversations.set(id, conv);
    return conv;
  }

  /**
   * Append the assistant's response to an existing conversation.
   */
  appendMessage(conversationId: string, content: string): MessageRecord | undefined {
    const conv = this.conversations.get(conversationId);
    if (!conv) return undefined;

    const msg: MessageRecord = {
      id: this.uuid(),
      conversationId,
      role: 'assistant',
      content,
      createdAt: new Date(),
    };
    conv.messages.push(msg);
    conv.updatedAt = new Date();
    return msg;
  }

  /** Retrieve a conversation by id (or undefined if missing). */
  findById(id: string): ConversationRecord | undefined {
    return this.conversations.get(id);
  }

  /** List all conversations for a user, most recently updated first. */
  findByUser(userId: string): ConversationRecord[] {
    return Array.from(this.conversations.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  /** Delete a conversation (cascades messages in real impl; here just removes from map). */
  delete(id: string): boolean {
    return this.conversations.delete(id);
  }

  // ─────────────────────────── helpers ────────────────────────────────────

  private uuid(): string {
    // 128-bit hex — good enough for an in-memory stub.
    return [...crypto.getRandomValues(new Uint8Array(16))]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  private truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) : s;
  }
}
