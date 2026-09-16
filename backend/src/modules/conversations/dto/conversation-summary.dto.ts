/**
 * Public conversation summary (list item).
 *
 * Mirrors `ConversationSummary` in the OpenAPI contract.
 */
export class ConversationSummaryDto {
  id!: string;
  modelId!: string;
  title!: string | null;
  pinned!: boolean;
  createdAt!: string;
  updatedAt!: string;
}
