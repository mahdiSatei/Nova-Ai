import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ChatRequestDto } from '../../src/modules/chat/dto/chat-request.dto';
import { RetryRequestDto } from '../../src/modules/chat/dto/retry-request.dto';

describe('ChatRequestDto.webSearch', () => {
  it('accepts a boolean flag', () => {
    const dto = plainToInstance(ChatRequestDto, { message: 'hi', webSearch: true });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.webSearch).toBe(true);
  });

  it('rejects a non-boolean flag', () => {
    const dto = plainToInstance(ChatRequestDto, { message: 'hi', webSearch: 'yes' });
    expect(validateSync(dto).some((e) => e.property === 'webSearch')).toBe(true);
  });
});

describe('RetryRequestDto.webSearch', () => {
  it('carries the failed message id and an optional flag', () => {
    const dto = plainToInstance(RetryRequestDto, { failedMessageId: 'm1', webSearch: true });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.webSearch).toBe(true);
  });
});
