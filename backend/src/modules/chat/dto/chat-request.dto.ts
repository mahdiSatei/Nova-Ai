import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

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

  /**
   * Optional: attach an uploaded file to this turn. The file must belong
   * to the caller; its extracted content is injected into this turn's
   * prompt only (never persisted into message history).
   */
  @IsOptional()
  @IsUUID('4', { message: 'fileId must be a valid uuid' })
  fileId?: string;
}
