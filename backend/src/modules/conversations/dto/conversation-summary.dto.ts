/**
 * Public conversation summary (list item).
 *
 * Mirrors `ConversationSummary` in the OpenAPI contract.
 */
export class ConversationSummaryDto {
  id!: string;
  modelId!: string;
  title!: string | null;
  createdAt!: string;
  updatedAt!: string;
}
