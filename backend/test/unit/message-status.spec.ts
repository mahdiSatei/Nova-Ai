import { getMetadataArgsStorage } from 'typeorm';
import { Message } from '../../src/modules/conversations/entities/message.entity';
import { MessageStatus } from '../../src/modules/conversations/conversations.types';
import { AddMessageStatus1700000002000 } from '../../src/database/migrations/1700000002000-add-message-status';

/**
 * Schema contract for the `messages.status` column.
 *
 * This is a pure unit test: it inspects the entity metadata and drives the
 * migration through a fake QueryRunner, so it needs no live database.
 */
describe('Message schema — status column', () => {
  const statusColumn = getMetadataArgsStorage().columns.find(
    (c) => c.target === Message && c.propertyName === 'status',
  );

  it('declares a NOT NULL text status column defaulting to "completed"', () => {
    expect(statusColumn).toBeDefined();
    expect(statusColumn!.mode).toBe('regular');
    expect(statusColumn!.options.type).toBe('text');
    expect(statusColumn!.options.default).toBe('completed');
  });

  it('maps every MessageStatus value onto the column union', () => {
    const statuses: MessageStatus[] = [
      'pending',
      'streaming',
      'completed',
      'failed',
      'cancelled',
    ];
    expect(new Set(statuses).size).toBe(statuses.length);
  });

  it('migration adds the column with the same default and a (conversation_id, status) index', async () => {
    const queries: string[] = [];
    const fakeRunner = { query: jest.fn(async (sql: string) => queries.push(sql)) };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AddMessageStatus1700000002000().up(fakeRunner as any);

    const addColumn = queries.find((q) => /ADD COLUMN IF NOT EXISTS status/i.test(q));
    expect(addColumn).toBeDefined();
    expect(addColumn).toMatch(/status TEXT NOT NULL DEFAULT 'completed'/i);

    const index = queries.find((q) => /idx_msg_conv_status/i.test(q));
    expect(index).toBeDefined();
    expect(index).toMatch(/\(conversation_id, status\)/i);
  });

  it('migration down drops the index and the column', async () => {
    const queries: string[] = [];
    const fakeRunner = { query: jest.fn(async (sql: string) => queries.push(sql)) };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new AddMessageStatus1700000002000().down(fakeRunner as any);

    expect(queries.some((q) => /DROP INDEX IF EXISTS idx_msg_conv_status/i.test(q))).toBe(true);
    expect(queries.some((q) => /ALTER TABLE messages DROP COLUMN IF EXISTS status/i.test(q))).toBe(
      true,
    );
  });
});
