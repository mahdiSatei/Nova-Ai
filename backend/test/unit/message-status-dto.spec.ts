import { MessagePublicDto } from '../../src/modules/conversations/dto/message-public.dto';
import { MessageStatus } from '../../src/modules/conversations/conversations.types';

describe('MessagePublicDto — status field', () => {
  it('serializes all status values', () => {
    const statuses: MessageStatus[] = ['pending', 'streaming', 'completed', 'failed', 'cancelled'];
    for (const status of statuses) {
      const dto = new MessagePublicDto();
      dto.id = 'm-1';
      dto.role = 'assistant';
      dto.content = 'hello';
      dto.createdAt = new Date().toISOString();
      dto.status = status;
      expect(dto.status).toBe(status);
    }
  });
});
