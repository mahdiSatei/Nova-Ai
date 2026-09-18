/**
 * In-memory record for the ConversationsService stub.
 *
 * T005 uses this as a lightweight stand-in so ChatService can be
 * developed and tested before the persistent ConversationsModule
 * exists. T006 swaps this for a full TypeORM-backed implementation.
 */
export interface ConversationRecord {
  id: string;
  userId: string;
  modelId: string;
  title: string | null;
  createdAt: Date;
  updatedAt: Date;
  messages: MessageRecord[];
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  status: MessageStatus;
}

export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
