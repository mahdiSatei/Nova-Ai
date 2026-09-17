import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Request body for POST /v1/chat/stream.
 *
 * FR-014: message length 1..32000 chars.
 */
export class ChatRequestDto {
  @IsString({ message: 'message must be a string' })
  @MinLength(1, { message: 'message must not be empty' })
  @MaxLength(32000, { message: 'message must be at most 32000 characters' })
  message!: string;

  /** Optional: resume an existing conversation. `null` is accepted for new chats. */
  @IsOptional()
  @IsString()
  conversationId?: string;

  /** Optional: override the active model for this turn. `null` falls back to sticky/default. */
  @IsOptional()
  @IsString()
  modelId?: string;
}
