import { MessageStatus } from '../conversations.types';
import type { CitationSource } from '../../web-search/web-search.types';

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
  citations?: CitationSource[];
  /** Phase 8 — whether reasoning was enabled for this turn. */
  reasoningEnabled?: boolean;
  /** Phase 8 — provider-generated user-visible summary, when one was exposed. */
  reasoningSummary?: string | null;
}
