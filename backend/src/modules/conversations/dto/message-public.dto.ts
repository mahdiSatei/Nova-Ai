import { MessageStatus } from '../conversations.types';

/**
 * Public message shape returned in conversation detail.
 *
 * Mirrors `MessagePublic` in the OpenAPI contract.
 */
export class MessagePublicDto {
  id!: string;
  role!: 'user' | 'assistant';
  content!: string;
  createdAt!: string;
  status!: MessageStatus;
}
