import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class RetryRequestDto {
  @IsString()
  @MinLength(1)
  failedMessageId!: string;

  /** Retry with web search enabled, matching the client's current toggle. */
  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  /** Retry with reasoning enabled, matching the client's current toggle. */
  @IsOptional()
  @IsBoolean()
  reasoning?: boolean;
}
