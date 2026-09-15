import { IsBoolean } from 'class-validator';

/**
 * Body for PATCH /v1/conversations/{id}/pin. Idempotent full-state
 * replacement of the conversation's pin flag.
 */
export class PinConversationDto {
  @IsBoolean()
  pinned!: boolean;
}
