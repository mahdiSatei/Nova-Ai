import { ConversationSummaryDto } from './conversation-summary.dto';
import { MessagePublicDto } from './message-public.dto';

/**
 * Full conversation detail with messages.
 *
 * Mirrors `ConversationDetail` in the OpenAPI contract.
 */
export class ConversationDetailDto extends ConversationSummaryDto {
  messages!: MessagePublicDto[];
}
