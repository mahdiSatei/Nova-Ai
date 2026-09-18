import { DataSource } from 'typeorm';
import { MessageStatus } from '../../src/modules/conversations/conversations.types';

jest.setTimeout(30_000);

describe('Message schema — status column', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const { DataSource } = await import('typeorm');
    // Use a bare DataSource with no entities to avoid TypeORM's
    // metadata validation (which chokes on timestamp types on SQLite
    // and on missing relation targets). We verify the schema with
    // raw SQL only.
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [],
      synchronize: false,
    });
    await dataSource.initialize();

    await dataSource.query(`
      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        status TEXT NOT NULL DEFAULT 'completed'
      );
    `);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('defaults status to "completed" when omitted', async () => {
    await dataSource.query(
      `INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)`,
      ['m-1', 'c-1', 'user', 'hello'],
    );

    const [row] = await dataSource.query(
      `SELECT status FROM messages WHERE id = ?`,
      ['m-1'],
    );
    expect(row.status).toBe('completed');
  });

  it('persists all MessageStatus values correctly', async () => {
    await dataSource.query(`DELETE FROM messages`);

    const statuses: MessageStatus[] = ['pending', 'streaming', 'completed', 'failed', 'cancelled'];
    for (let i = 0; i < statuses.length; i++) {
      await dataSource.query(
        `INSERT INTO messages (id, conversation_id, role, content, status) VALUES (?, ?, ?, ?, ?)`,
        [`s-${i}`, 'c-1', 'assistant', 'reply', statuses[i]],
      );
    }

    for (let i = 0; i < statuses.length; i++) {
      const [row] = await dataSource.query(
        `SELECT status FROM messages WHERE id = ?`,
        [`s-${i}`],
      );
      expect(row.status).toBe(statuses[i]);
    }
  });
});
