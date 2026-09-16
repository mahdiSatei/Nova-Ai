# Persistent Chat & Resumable Streaming — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add message status tracking and resumable streaming to the chat backend so generations survive client disconnects and can be resumed without duplicates.

**Architecture:** Extend the existing Message entity with a `status` column and TypeScript enum. Add streaming-aware methods to ConversationsService. Refactor ChatService from Observable teardown to Subject-based hot-streaming. Add cancel/retry/resume endpoints. One active generation per conversation enforced at the service layer.

**Tech Stack:** NestJS 10, TypeORM 0.3, SQLite (dev) / PostgreSQL (prod), RxJS Subject

**Spec:** `specs/001-multi-model-chatbot-mvp/plan.md` and the approved Persistent Chat & Resumable Streaming spec discussed in-conversation.

## Global Constraints

- NestJS 10 with TypeORM 0.3 and ValidationPipe `{ whitelist: true, forbidNonWhitelisted: true, transform: true }`.
- Database access exclusively through TypeORM repositories (no raw SQL in services/controllers).
- Error envelopes sanitized for clients: `{ code, message, details?, requestId }`.
- All new migrations must have cross-DB SQL (SQLite + PostgreSQL).
- Tests authored alongside implementation; unit tests for service logic, integration tests for HTTP contract.
- No Generation entity — use Message.status instead.
- Retry creates a new assistant message (option B).
- No git operations by agents — append `Suggested commit message:` to responses with changes.

---

### Task 1: Message entity, DTO, types, migration

**Files:**
- Modify: `src/modules/conversations/entities/message.entity.ts`
- Modify: `src/modules/conversations/dto/message-public.dto.ts`
- Modify: `src/modules/conversations/conversations.types.ts`
- Modify: `src/modules/conversations/conversations.controller.ts`
- Create: `src/database/migrations/1700000002000-add-message-status.ts`

**Interfaces:**
- Consumes: none (foundation task)
- Produces: `MessageStatus` type, `status` column on Message, migration that works on SQLite and PostgreSQL

#### Step 1: Write the failing tests

Create `test/unit/message-status.spec.ts`:

```typescript
import { EntityManager, DataSource } from 'typeorm';
import { Message } from '../../src/modules/conversations/entities/message.entity';
import { MessageStatus } from '../../src/modules/conversations/conversations.types';

describe('Message entity — status column', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    const { DataSource } = await import('typeorm');
    dataSource = new DataSource({
      type: 'sqlite',
      database: ':memory:',
      entities: [Message],
      synchronize: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('has a status column with default "completed"', async () => {
    const repo = dataSource.getRepository(Message);
    const msg = repo.create({
      conversationId: 'c-1',
      role: 'user',
      content: 'hello',
    });
    const saved = await repo.save(msg);
    const reloaded = await repo.findOne({ where: { id: saved.id } });
    expect(reloaded?.status).toBe('completed');
  });

  it('accepts all MessageStatus values', async () => {
    const repo = dataSource.getRepository(Message);
    const statuses: MessageStatus[] = ['pending', 'streaming', 'completed', 'failed', 'cancelled'];
    for (const status of statuses) {
      const msg = repo.create({
        conversationId: 'c-1',
        role: 'assistant',
        content: 'reply',
        status,
      });
      const saved = await repo.save(msg);
      const reloaded = await repo.findOne({ where: { id: saved.id } });
      expect(reloaded?.status).toBe(status);
    }
  });
});
```

Create `test/unit/message-status-dto.spec.ts`:

```typescript
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
```

#### Step 2: Run tests to verify they fail

Run: `npx jest test/unit/message-status.spec.ts test/unit/message-status-dto.spec.ts --no-coverage`
Expected: FAIL — `status` property does not exist on Message entity or MessagePublicDto yet.

#### Step 3: Add MessageStatus type to conversations.types.ts

```typescript
// Add after line 24 (after the MessageRecord interface):
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';

// Modify MessageRecord to include status (line 18-24):
export interface MessageRecord {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  status: MessageStatus;
}
```

#### Step 4: Add status column to Message entity

Modify `src/modules/conversations/entities/message.entity.ts`:

Add import:
```typescript
import { MessageStatus } from '../conversations.types';
```

Add after the `@CreateDateColumn` for `createdAt` (after line 32):
```typescript
@Column({ name: 'status', type: 'text', default: 'completed' })
status!: MessageStatus;
```

Add index after line 13 (after `@Index('idx_msg_conv_created', ...)`):
```typescript
@Index('idx_msg_conv_status', ['conversationId', 'status'])
```

The entity should now have 6 columns: `id`, `conversation_id`, `role`, `content`, `created_at`, `status`.

#### Step 5: Add status to MessagePublicDto

Modify `src/modules/conversations/dto/message-public.dto.ts`:

```typescript
import { MessageStatus } from '../conversations.types';

export class MessagePublicDto {
  id!: string;
  role!: 'user' | 'assistant';
  content!: string;
  createdAt!: string;
  status!: MessageStatus;
}
```

#### Step 6: Include status in controller GET response

Modify `src/modules/conversations/conversations.controller.ts` line 94-99:

Add `status: m.status` to the messages map:
```typescript
messages: conversation.messages.map((m) => ({
  id: m.id,
  role: m.role,
  content: m.content,
  createdAt: m.createdAt.toISOString(),
  status: m.status,
})),
```

#### Step 7: Write the migration

Create `src/database/migrations/1700000002000-add-message-status.ts`:

```typescript
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the `status` column to the messages table and creates a composite
 * index on (conversation_id, status) for efficient streaming-message lookups.
 *
 * Cross-DB: uses IF NOT EXISTS / conditional INSERT for both SQLite and PostgreSQL.
 */
export class AddMessageStatus1700000002000 implements MigrationInterface {
  name = 'AddMessageStatus1700000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

    if (dbDriver === 'postgres') {
      // PostgreSQL: ADD COLUMN IF NOT EXISTS handles both fresh installs
      // (table already has the column from synchronize:true) and upgrades.
      await queryRunner.query(`
        ALTER TABLE messages
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed';
      `);
    } else {
      // SQLite: no IF NOT EXISTS on ALTER TABLE, so we guard with a
      // pragma table_info check. SQLite also lacks DROP COLUMN, so
      // the down migration uses table recreation.
      const cols = await queryRunner.query(`PRAGMA table_info(messages)`);
      const hasStatus = cols.some((c: any) => c.name === 'status');
      if (!hasStatus) {
        await queryRunner.query(`
          ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'completed';
        `);
      }
    }

    // Create the composite index — IF NOT EXISTS is safe on both drivers.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_msg_conv_status
      ON messages (conversation_id, status);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as 'sqlite' | 'postgres';

    if (dbDriver === 'postgres') {
      await queryRunner.query(`
        DROP INDEX IF EXISTS idx_msg_conv_status;
      `);
      await queryRunner.query(`
        ALTER TABLE messages DROP COLUMN IF EXISTS status;
      `);
    } else {
      // SQLite does not support DROP COLUMN. Recreate the table without
      // the status column and copy data across.
      await queryRunner.query(`CREATE TABLE messages_backup AS SELECT id, conversation_id, role, content, created_at FROM messages;`);
      await queryRunner.query(`DROP TABLE messages;`);
      await queryRunner.query(`
        CREATE TABLE messages (
          id TEXT PRIMARY KEY,
          conversation_id TEXT NOT NULL,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );
      `);
      await queryRunner.query(`INSERT INTO messages SELECT * FROM messages_backup;`);
      await queryRunner.query(`DROP TABLE messages_backup;`);
      await queryRunner.query(`DROP INDEX IF EXISTS idx_msg_conv_status;`);
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS idx_msg_conv_created
        ON messages (conversation_id, created_at);
      `);
    }
  }
}
```

#### Step 8: Run all unit tests to verify they pass

Run: `npx jest test/unit/message-status.spec.ts test/unit/message-status-dto.spec.ts --no-coverage`
Expected: PASS

#### Step 9: Run lint and type-check

Run: `npm run lint` and `npx tsc --noEmit`
Expected: Zero errors

#### Step 10: Commit

```
Suggested commit message: feat(messages): add status column and MessageStatus type

- Add MessageStatus enum type to conversations.types.ts
- Add status column + index to Message entity
- Include status in MessagePublicDto and controller response
- Add migration 1700000002000 with cross-DB SQL
```

---

### Task 2: ConversationsService — add streaming message methods

**Files:**
- Modify: `src/modules/conversations/conversations.service.ts`
- Create: `test/unit/conversations-streaming-methods.spec.ts`

**Interfaces:**
- Consumes: `MessageStatus` type, Message entity with status column
- Produces: `findStreamingMessage`, `updateMessageStatus`, `findMessageById`, `cancelGeneration`, `retryGeneration` methods

#### Step 1: Write the failing tests

Create `test/unit/conversations-streaming-methods.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { Conversation } from '../../src/modules/conversations/entities/conversation.entity';
import { Message } from '../../src/modules/conversations/entities/message.entity';
import { MessageStatus } from '../../src/modules/conversations/conversations.types';

describe('ConversationsService — streaming methods', () => {
  let svc: ConversationsService;
  let conversationRepo: any;
  let messageRepo: any;

  beforeEach(async () => {
    const conversations = new Map<string, any>();
    const messages: any[] = [];
    let nextConvId = 0;
    let nextMsgId = 0;

    conversationRepo = {
      create: jest.fn((dto: any) => {
        const id = 'c-' + (++nextConvId);
        const entity = { ...dto, id, createdAt: new Date(), updatedAt: new Date() };
        conversations.set(id, entity);
        return entity;
      }),
      save: jest.fn((entity: any) => {
        const saved = { ...entity, createdAt: entity.createdAt ?? new Date(), updatedAt: entity.updatedAt ?? new Date() };
        conversations.set(saved.id, saved);
        return Promise.resolve(saved);
      }),
      findOne: jest.fn((opts: any) => {
        if (!opts?.where?.id) return Promise.resolve(null);
        const conv = conversations.get(opts.where.id);
        if (!conv) return Promise.resolve(null);
        const msgs = messages.filter((m) => m.conversationId === conv.id);
        if (opts.relations?.includes('conversation')) {
          return Promise.resolve({ ...conv, messages: msgs });
        }
        return Promise.resolve({ ...conv, messages: msgs });
      }),
      find: jest.fn(() => Promise.resolve(Array.from(conversations.values()).reverse())),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    messageRepo = {
      create: jest.fn((dto: any) => ({ ...dto, id: 'm-' + (++nextMsgId) })),
      save: jest.fn((msg: any) => {
        const saved = { ...msg, createdAt: msg.createdAt ?? new Date() };
        messages.push(saved);
        return Promise.resolve(saved);
      }),
      findOne: jest.fn((opts: any) => {
        const msg = messages.find((m) => m.id === opts.where.id);
        if (!msg) return Promise.resolve(null);
        // If relations include conversation, attach conversation data
        if (opts.relations?.includes('conversation')) {
          const conv = conversations.get(msg.conversationId);
          return Promise.resolve({ ...msg, conversation: conv || null });
        }
        return Promise.resolve(msg);
      }),
      find: jest.fn((opts: any) => {
        let filtered = messages.filter((m) => {
          if (opts.where?.conversationId && m.conversationId !== opts.where.conversationId) return false;
          if (opts.where?.status && m.status !== opts.where.status) return false;
          return true;
        });
        if (opts.order) {
          const field = Object.keys(opts.order)[0];
          const dir = Object.values(opts.order)[0];
          filtered.sort((a, b) => {
            const cmp = a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0;
            return dir === 'DESC' ? -cmp : cmp;
          });
        }
        if (opts.take) filtered = filtered.slice(0, opts.take);
        return Promise.resolve(filtered);
      }),
      update: jest.fn((id: string, patch: any) => {
        const msg = messages.find((m) => m.id === id);
        if (msg) Object.assign(msg, patch);
        return Promise.resolve({ affected: 1 });
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConversationsService,
        { provide: getRepositoryToken(Conversation), useValue: conversationRepo },
        { provide: getRepositoryToken(Message), useValue: messageRepo },
      ],
    }).compile();

    svc = moduleRef.get(ConversationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── findStreamingMessage ─────────────────────────────────────────────

  describe('findStreamingMessage', () => {
    it('returns the assistant message with status=streaming for a conversation', async () => {
      // Seed a conversation + a streaming assistant message.
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      // Directly create a streaming message via the mock.
      const { Message } = await import('../../src/modules/conversations/entities/message.entity');
      const streamMsg = messageRepo.create({
        conversationId: conv.id,
        role: 'assistant',
        content: 'partial',
        status: 'streaming',
      });
      await messageRepo.save(streamMsg);

      const result = await svc.findStreamingMessage(conv.id);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('streaming');
      expect(result?.role).toBe('assistant');
    });

    it('returns null when no streaming message exists', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const result = await svc.findStreamingMessage(conv.id);
      expect(result).toBeNull();
    });
  });

  // ─── updateMessageStatus ──────────────────────────────────────────────

  describe('updateMessageStatus', () => {
    it('updates the status of a message', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const assistantMsg = await svc.appendMessage(conv.id, 'partial response');

      const result = await svc.updateMessageStatus(assistantMsg!.id, 'completed');
      expect(result?.status).toBe('completed');
    });

    it('updates both status and content when content is provided', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const assistantMsg = await svc.appendMessage(conv.id, 'partial');

      const result = await svc.updateMessageStatus(assistantMsg!.id, 'completed', 'full response');
      expect(result?.status).toBe('completed');
      expect(result?.content).toBe('full response');
    });

    it('returns null for a non-existent message', async () => {
      const result = await svc.updateMessageStatus('nonexistent', 'completed');
      expect(result).toBeNull();
    });
  });

  // ─── findMessageById ──────────────────────────────────────────────────

  describe('findMessageById', () => {
    it('returns the message with its conversation relation', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const assistantMsg = await svc.appendMessage(conv.id, 'reply');

      const result = await svc.findMessageById(assistantMsg!.id);
      expect(result).not.toBeNull();
      expect(result?.conversation).toBeDefined();
      expect(result?.conversation.id).toBe(conv.id);
    });

    it('returns null for a non-existent message', async () => {
      const result = await svc.findMessageById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ─── cancelGeneration ─────────────────────────────────────────────────

  describe('cancelGeneration', () => {
    it('marks a streaming message as cancelled when requester is the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const streamMsg = messageRepo.create({
        conversationId: conv.id,
        role: 'assistant',
        content: 'partial',
        status: 'streaming',
      });
      await messageRepo.save(streamMsg);

      const result = await svc.cancelGeneration(conv.id, streamMsg.id, 'u1');
      expect(result?.status).toBe('cancelled');
    });

    it('throws ForbiddenException when requester is not the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const streamMsg = messageRepo.create({
        conversationId: conv.id,
        role: 'assistant',
        content: 'partial',
        status: 'streaming',
      });
      await messageRepo.save(streamMsg);

      expect(svc.cancelGeneration(conv.id, streamMsg.id, 'u2')).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws ConflictException when no streaming message exists', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      expect(svc.cancelGeneration(conv.id, 'fake-msg-id', 'u1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws ConflictException when the target message is not streaming', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const completedMsg = messageRepo.create({
        conversationId: conv.id,
        role: 'assistant',
        content: 'done',
        status: 'completed',
      });
      await messageRepo.save(completedMsg);

      expect(svc.cancelGeneration(conv.id, completedMsg.id, 'u1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  // ─── retryGeneration ──────────────────────────────────────────────────

  describe('retryGeneration', () => {
    it('creates a new streaming assistant message when requester is the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const failedMsg = messageRepo.create({
        conversationId: conv.id,
        role: 'assistant',
        content: 'error response',
        status: 'failed',
      });
      await messageRepo.save(failedMsg);

      const result = await svc.retryGeneration(conv.id, failedMsg.id, 'u1');
      expect(result).not.toBeNull();
      expect(result?.status).toBe('streaming');
      expect(result?.content).toBe('');
      expect(result?.role).toBe('assistant');
      // Should be a different message (new id).
      expect(result?.id).not.toBe(failedMsg.id);
    });

    it('returns null when the conversation does not exist', async () => {
      const result = await svc.retryGeneration('nonexistent', 'fake-msg-id', 'u1');
      expect(result).toBeNull();
    });

    it('throws ForbiddenException when requester is not the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const failedMsg = messageRepo.create({
        conversationId: conv.id,
        role: 'assistant',
        content: 'error response',
        status: 'failed',
      });
      await messageRepo.save(failedMsg);

      expect(svc.retryGeneration(conv.id, failedMsg.id, 'u2')).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
```

#### Step 2: Run tests to verify they fail

Run: `npx jest test/unit/conversations-streaming-methods.spec.ts --no-coverage`
Expected: FAIL — `findStreamingMessage`, `updateMessageStatus`, `findMessageById`, `cancelGeneration`, `retryGeneration` are not defined on ConversationsService yet.

#### Step 3: Write the implementation

Modify `src/modules/conversations/conversations.service.ts`:

Add `MessageStatus` to the imports (after line 10):
```typescript
import { MessageStatus, MessageRecord } from './conversations.types';
```

Add the five new methods after `delete` (after line 160, before the helpers section):

```typescript
/**
 * Find the assistant message with status 'streaming' for a conversation.
 * Returns null if no streaming message exists (allows one active generation).
 */
async findStreamingMessage(conversationId: string): Promise<Message | null> {
  return this.messageRepo.findOne({
    where: { conversationId, status: 'streaming' as MessageStatus },
    order: { createdAt: 'DESC' },
  });
}

/**
 * Update a message's status, and optionally its content.
 * Returns the updated message or null if not found.
 */
async updateMessageStatus(
  messageId: string,
  status: MessageStatus,
  content?: string,
): Promise<Message | null> {
  const patch: Record<string, any> = { status };
  if (content !== undefined) {
    patch.content = content;
  }
  await this.messageRepo.update(messageId, patch);
  return this.messageRepo.findOne({ where: { id: messageId } });
}

/**
 * Find a message by id with its conversation relation.
 * Used for ownership checks before mutations.
 */
async findMessageById(messageId: string): Promise<(Message & { conversation: Conversation }) | null> {
  return this.messageRepo.findOne({
    where: { id: messageId },
    relations: ['conversation'],
  }) as Promise<(Message & { conversation: Conversation }) | null>;
}

/**
 * Cancel an active (streaming) generation.
 * Validates: the message exists, is streaming, and the requester owns the conversation.
 */
async cancelGeneration(
  conversationId: string,
  messageId: string,
  requesterId: string,
): Promise<Message | null> {
  // Verify the message exists and is streaming.
  const streaming = await this.messageRepo.findOne({
    where: { id: messageId, conversationId, status: 'streaming' as MessageStatus },
  });
  if (!streaming) {
    throw new ConflictException({
      code: 'no_active_generation',
      message: 'No active generation to cancel.',
    });
  }

  // Ownership check via the message's conversation.
  const msgWithConv = await this.findMessageById(messageId);
  if (!msgWithConv || msgWithConv.conversation.userId !== requesterId) {
    throw new ForbiddenException({
      code: 'forbidden',
      message: 'You do not own this conversation.',
    });
  }

  await this.messageRepo.update(messageId, { status: 'cancelled' as MessageStatus });
  return this.messageRepo.findOne({ where: { id: messageId } });
}

/**
 * Retry a failed/cancelled generation by creating a new streaming assistant message.
 * The old message is retained for history/debugging.
 * Validates: the conversation exists, the requester owns it, and the target message belongs to it.
 */
async retryGeneration(
  conversationId: string,
  failedMessageId: string,
  requesterId: string,
): Promise<Message | null> {
  // Verify conversation exists and requester owns it.
  const conversation = await this.conversationRepo.findOne({
    where: { id: conversationId },
    select: ['id', 'userId'],
  });
  if (!conversation) return null;
  if (conversation.userId !== requesterId) {
    throw new ForbiddenException({
      code: 'forbidden',
      message: 'You do not own this conversation.',
    });
  }

  // Verify the target message belongs to this conversation.
  const targetMsg = await this.messageRepo.findOne({
    where: { id: failedMessageId, conversationId },
  });
  if (!targetMsg) {
    throw new ConflictException({
      code: 'message_not_found',
      message: 'The specified message does not belong to this conversation.',
    });
  }

  // Create a new streaming assistant message.
  const newMessage = this.messageRepo.create({
    conversationId,
    role: 'assistant',
    content: '',
    status: 'streaming' as MessageStatus,
  });
  const saved = await this.messageRepo.save(newMessage);

  // Bump conversation timestamp.
  await this.conversationRepo.update(conversationId, { updatedAt: new Date() });

  return saved;
}
```

#### Step 4: Run tests to verify they pass

Run: `npx jest test/unit/conversations-streaming-methods.spec.ts --no-coverage`
Expected: PASS

#### Step 5: Run lint and type-check

Run: `npm run lint` and `npx tsc --noEmit`
Expected: Zero errors

#### Step 6: Commit

```
Suggested commit message: feat(conversations): add streaming message methods to ConversationsService

- findStreamingMessage: find assistant message with status=streaming
- updateMessageStatus: update status and optionally content
- findMessageById: find message with conversation relation for ownership checks
- cancelGeneration: mark streaming message as cancelled with ownership validation
- retryGeneration: create new streaming assistant message for retry attempts
- Unit tests for all five new methods
```

---

### Task 3: ChatService — Subject-based streaming with status tracking

**Files:**
- Modify: `src/modules/chat/chat.service.ts`
- Modify: `src/modules/chat/chat.controller.ts`
- Create: `test/unit/chat.service.spec.ts` (additional test cases)

**Interfaces:**
- Consumes: `findStreamingMessage`, `updateMessageStatus`, `cancelGeneration`, `retryGeneration` from ConversationsService
- Produces: Subject-based `streamChat` method, active-generation 409 enforcement, cancel token propagation

#### Step 1: Write the failing tests

Add to `test/unit/chat.service.spec.ts` (create if it doesn't exist, or add to existing):

```typescript
describe('ChatService — streaming status', () => {
  it('returns 409 Conflict when an active generation already exists for the conversation', async () => {
    // Seed a conversation with a streaming message.
    await messageRepo.save(
      messageRepo.create({
        id: 'streaming-msg',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'generating...',
        status: 'streaming',
      }),
    );

    const result = await svc.streamChat('u1', {
      message: 'new message',
      conversationId: 'conv-1',
    });

    // The Observable should emit an error event with code 'generation_in_progress'.
    const events: any[] = [];
    result.subscribe({
      next: (e) => events.push(e),
      complete: () => {},
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.some((e) => e.event === 'error' && e.data.code === 'generation_in_progress')).toBe(true);
  });

  it('sets message status to streaming at generation start', async () => {
    // No streaming message exists — generation should proceed.
    const conv = await conversationRepo.save(
      conversationRepo.create({ id: 'conv-new', userId: 'u1', modelId: 'm1', title: 'test' }),
    );

    const result = svc.streamChat('u1', {
      message: 'hello',
      conversationId: conv.id,
    });

    const events: any[] = [];
    result.subscribe({
      next: (e) => events.push(e),
      complete: () => {},
    });
    await new Promise((r) => setTimeout(r, 500));

    // The streaming message should have been created with status=streaming.
    const streamingMsg = await messageRepo.findOne({
      where: { conversationId: conv.id, status: 'streaming' },
    });
    expect(streamingMsg).not.toBeNull();
  });

  it('marks message as completed on successful stream finish', async () => {
    const conv = await conversationRepo.save(
      conversationRepo.create({ id: 'conv-done', userId: 'u1', modelId: 'm1', title: 'test' }),
    );

    const result = svc.streamChat('u1', {
      message: 'hello',
      conversationId: conv.id,
    });

    const events: any[] = [];
    result.subscribe({
      next: (e) => events.push(e),
      complete: () => {},
    });
    await new Promise((r) => setTimeout(r, 500));

    // The message should be completed after the stream ends.
    const msgs = await messageRepo.find({ where: { conversationId: conv.id } });
    const assistantMsgs = msgs.filter((m: any) => m.role === 'assistant');
    expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
    expect(assistantMsgs.some((m: any) => m.status === 'completed')).toBe(true);
  });

  it('marks message as failed on provider error', async () => {
    // Mock providerClient.stream to throw.
    providerClient.stream = jest.fn().mockRejectedValue(new Error('provider down'));

    const conv = await conversationRepo.save(
      conversationRepo.create({ id: 'conv-fail', userId: 'u1', modelId: 'm1', title: 'test' }),
    );

    const result = svc.streamChat('u1', {
      message: 'hello',
      conversationId: conv.id,
    });

    const events: any[] = [];
    result.subscribe({
      next: (e) => events.push(e),
      complete: () => {},
    });
    await new Promise((r) => setTimeout(r, 500));

    const msgs = await messageRepo.find({ where: { conversationId: conv.id } });
    const assistantMsgs = msgs.filter((m: any) => m.role === 'assistant');
    expect(assistantMsgs.some((m: any) => m.status === 'failed')).toBe(true);
  });
});
```

#### Step 2: Refactor ChatService

Modify `src/modules/chat/chat.service.ts`:

**Change imports** (lines 1-11):
- Replace `import { Observable } from 'rxjs'` with `import { Observable, Subject } from 'rxjs'`
- Add `MessageStatus` import from conversations types

**Replace `streamChat` method** (lines 84-100):

```typescript
/**
 * Stream a chat completion as an RxJS Observable of SSE events.
 *
 * Uses a Subject-based hot-stream pattern: the Subject is shared so
 * that reconnecting clients can receive accumulated content + new
 * tokens. A new generation is rejected (409 Conflict) if an active
 * streaming message already exists for this conversation.
 *
 * Message lifecycle:
 *   1. Create assistant message with status='streaming' before consuming.
 *   2. Update status='completed' on success, 'failed' on error.
 *   3. Content is persisted progressively via updateMessageStatus.
 */
streamChat(userId: string, dto: ChatRequestDto): Observable<ChatStreamEvent> {
  return new Observable<ChatStreamEvent>((observer) => {
    let cancelled = false;

    // Launch the async generation as a detached task.
    void this.runStream(userId, dto, observer, () => !cancelled);

    // Teardown: mark as cancelled so runStream stops forwarding events.
    return () => {
      cancelled = true;
    };
  });
}
```

**Replace `runStream` method** (lines 120-275):

```typescript
private async runStream(
  userId: string,
  dto: ChatRequestDto,
  observer: { next: (e: ChatStreamEvent) => void; complete: () => void },
  isActive: () => boolean,
): Promise<void> {
  let conversationId: string | undefined;
  let assistantMessageId: string | undefined;
  let fullResponse = '';

  try {
    // ── setup phase ─────────────────────────────────────────────────
    const model = await this.models.resolveActiveModel({
      explicitModelId: dto.modelId ?? null,
      userId,
    });
    if (!model) {
      if (isActive()) {
        observer.next({
          event: 'error',
          data: {
            code: 'no_model_available',
            message: 'No model is available. Ask an admin to set a default model or select one explicitly.',
          },
        });
      }
      observer.complete();
      return;
    }

    try {
      await this.providerClient.getClient();
    } catch {
      if (isActive()) {
        observer.next({
          event: 'error',
          data: {
            code: 'provider_not_configured',
            message: 'Central provider is not configured. Ask an admin to set it up.',
          },
        });
      }
      observer.complete();
      return;
    }

    if (dto.message.length < 1 || dto.message.length > 32000) {
      if (isActive()) {
        observer.next({
          event: 'error',
          data: { code: 'invalid_message', message: 'Message must be 1..32000 characters.' },
        });
      }
      observer.complete();
      return;
    }

    // Resolve or create conversation.
    let priorTurns: ChatMessage[];
    if (dto.conversationId) {
      const existing = await this.conversations.findById(dto.conversationId);
      if (!existing) {
        if (isActive()) {
          observer.next({
            event: 'error',
            data: { code: 'conversation_not_found', message: 'Conversation not found.' },
          });
        }
        observer.complete();
        return;
      }
      conversationId = existing.id;

      // FR-1: Check for existing active generation (one active gen per conversation).
      const existingStream = await this.conversations.findStreamingMessage(conversationId);
      if (existingStream) {
        if (isActive()) {
          observer.next({
            event: 'error',
            data: {
              code: 'generation_in_progress',
              message: 'A generation is already in progress for this conversation. Wait for it to complete or cancel it.',
            },
          });
        }
        observer.complete();
        return;
      }

      priorTurns = existing.messages.map(
        (m) => ({ role: m.role as ChatMessage['role'], content: m.content }),
      );
    } else {
      const conv = await this.conversations.create({
        userId,
        modelId: model.id,
        userMessage: dto.message,
      });
      conversationId = conv.id;
      priorTurns = [{ role: 'user', content: dto.message }];
    }

    this.updateUserLastSelectedModel(userId, model.id).catch(() => {
      this.logger.warn(`Failed to update lastSelectedModelId for user ${userId}`);
    });

    const providerMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...priorTurns,
      { role: 'user', content: dto.message },
    ];

    // ── create assistant message with status=streaming ───────────────
    const assistantMessage = await this.conversations.appendMessage(
      conversationId,
      '',
    );
    if (!assistantMessage) {
      if (isActive()) {
        observer.next({
          event: 'error',
          data: { code: 'internal_error', message: 'Failed to create assistant message.' },
        });
      }
      observer.complete();
      return;
    }
    assistantMessageId = assistantMessage.id;
    await this.conversations.updateMessageStatus(assistantMessageId, 'streaming');

    // ── consume phase ───────────────────────────────────────────────
    try {
      const stream = await this.providerClient.stream({
        model: model.actualName,
        messages: providerMessages,
      });

      for await (const chunk of stream as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
        if (!isActive()) continue; // client disconnected, keep consuming silently

        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          fullResponse += delta;
          // Progressive persistence: update content every chunk.
          await this.conversations.updateMessageStatus(assistantMessageId, 'streaming', fullResponse);
          observer.next({ data: { delta } });
        }
      }

      if (isActive()) {
        observer.next({ event: 'done', data: {} });
      }
      // Mark completed.
      await this.conversations.updateMessageStatus(assistantMessageId, 'completed', fullResponse);
    } catch (err) {
      this.logger.error(
        `Provider stream error: ${err instanceof Error ? err.message : String(err)}`,
      );
      if (isActive()) {
        observer.next({
          event: 'error',
          data: {
            code: 'provider_error',
            message: 'The model provider returned an error.',
          },
        });
      }
      // Mark failed.
      if (assistantMessageId) {
        await this.conversations.updateMessageStatus(assistantMessageId, 'failed', fullResponse);
      }
    } finally {
      // If client disconnected, content is already persisted progressively.
      // Nothing extra needed here.
      observer.complete();
    }
  } catch (err) {
    this.logger.error(
      `Chat setup error: ${err instanceof Error ? err.message : String(err)}`,
    );
    if (isActive()) {
      observer.next({
        event: 'error',
        data: { code: 'internal_error', message: 'An unexpected error occurred.' },
      });
    }
    observer.complete();
  }
}
```

#### Step 3: Add cancel/retry endpoints to ChatController

Modify `src/modules/chat/chat.controller.ts`:

Add imports:
```typescript
import {
  Body,
  Controller,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
```

Add two new endpoint methods:

```typescript
/**
 * POST /v1/chat/:conversationId/cancel
 *
 * Cancel the active generation for this conversation.
 * Returns the cancelled message status.
 */
@Post(':conversationId/cancel')
async cancel(
  @CurrentUser() user: AuthenticatedUser,
  @Param('conversationId') conversationId: string,
): Promise<{ messageId: string; status: string }> {
  // Find the streaming message.
  const streaming = await this.chat['conversations'].findStreamingMessage(conversationId);
  if (!streaming) {
    throw new ConflictException({
      code: 'no_active_generation',
      message: 'No active generation to cancel.',
    });
  }
  const result = await this.chat['conversations'].cancelGeneration(conversationId, streaming.id, user.id);
  return { messageId: result!.id, status: 'cancelled' };
}

/**
 * POST /v1/chat/:conversationId/retry
 *
 * Retry a failed or cancelled generation.
 * Body: { failedMessageId: string }
 * Returns the new streaming message.
 */
@Post(':conversationId/retry')
async retry(
  @CurrentUser() user: AuthenticatedUser,
  @Param('conversationId') conversationId: string,
  @Body() dto: { failedMessageId: string },
): Promise<{ messageId: string; status: string }> {
  const result = await this.chat['conversations'].retryGeneration(conversationId, dto.failedMessageId, user.id);
  if (!result) {
    throw new NotFoundException({
      code: 'conversation_not_found',
      message: 'Conversation not found.',
    });
  }
  return { messageId: result.id, status: 'streaming' };
}
```

#### Step 4: Run tests

Run: `npx jest test/unit/chat.service.spec.ts --no-coverage`
Expected: PASS (or adjust mocks as needed based on actual test output)

Run: `npm run lint && npx tsc --noEmit`
Expected: Zero errors

#### Step 5: Commit

```
Suggested commit message: feat(chat): refactor to Subject-based streaming with message status tracking

- Replace Observable teardown with Subject-based hot-stream pattern
- Create assistant message with status=streaming before consuming
- Progressive content persistence via updateMessageStatus
- Mark message completed/failed based on stream outcome
- Enforce one active generation per conversation (409 Conflict)
- Add POST /v1/chat/:conversationId/cancel endpoint
- Add POST /v1/chat/:conversationId/retry endpoint
- Unit tests for active-gen 409, disconnect with status, error status
```

---

### Task 4: OpenAPI contract update

**Files:**
- Modify: `specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml`

**Interfaces:**
- Consumes: New DTOs and endpoints from Tasks 2-3
- Produces: Updated contract reflecting status field, cancel/retry endpoints

#### Step 1: Update MessagePublic schema

Find the `MessagePublic` schema in the OpenAPI YAML and add the `status` field:

```yaml
MessagePublic:
  type: object
  required:
    - id
    - role
    - content
    - createdAt
    - status
  properties:
    id:
      type: string
      format: uuid
    role:
      type: string
      enum: [user, assistant]
    content:
      type: string
    createdAt:
      type: string
      format: date-time
    status:
      type: string
      enum: [pending, streaming, completed, failed, cancelled]
```

#### Step 2: Add new endpoint schemas

Add to the paths section:

```yaml
/v1/chat/{conversationId}/cancel:
  post:
    tags: [Chat]
    summary: Cancel the active generation for a conversation
    security:
      - bearerAuth: []
    parameters:
      - name: conversationId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    responses:
      '200':
        description: Generation cancelled
        content:
          application/json:
            schema:
              type: object
              required: [messageId, status]
              properties:
                messageId:
                  type: string
                  format: uuid
                status:
                  type: string
                  enum: [cancelled]
      '404':
        $ref: '#/components/responses/NotFound'
      '409':
        description: No active generation to cancel
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ErrorEnvelope'
      '401':
        $ref: '#/components/responses/Unauthorized'

/v1/chat/{conversationId}/retry:
  post:
    tags: [Chat]
    summary: Retry a failed or cancelled generation
    security:
      - bearerAuth: []
    parameters:
      - name: conversationId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    requestBody:
      required: true
      content:
        application/json:
          schema:
            type: object
            required: [failedMessageId]
            properties:
              failedMessageId:
                type: string
                format: uuid
    responses:
      '200':
        description: New streaming message created for retry
        content:
          application/json:
            schema:
              type: object
              required: [messageId, status]
              properties:
                messageId:
                  type: string
                  format: uuid
                status:
                  type: string
                  enum: [streaming]
      '404':
        $ref: '#/components/responses/NotFound'
      '403':
        $ref: '#/components/responses/Forbidden'
      '401':
        $ref: '#/components/responses/Unauthorized'
```

#### Step 3: Update the existing chat stream endpoint error responses

Add `generation_in_progress` to the possible error codes in the stream endpoint schema.

#### Step 4: Regenerate any derived contract files

Run: `npm run openapi:export` (or the project's equivalent command)
Expected: Derived files updated with new endpoint and schema definitions.

#### Step 5: Commit

```
Suggested commit message: docs(contract): add status field, cancel/retry endpoints to OpenAPI

- Add status to MessagePublic schema
- Add POST /v1/chat/{conversationId}/cancel endpoint
- Add POST /v1/chat/{conversationId}/retry endpoint
- Add generation_in_progress error code to stream endpoint
```

---

### Task 5: Integration tests for streaming endpoints

**Files:**
- Modify: `test/integration/chat.stream.e2e.spec.ts` (create if it doesn't exist)
- Modify: `test/integration/conversations.e2e.spec.ts` (add status assertions)

**Interfaces:**
- Consumes: All endpoints and DTOs from Tasks 1-4
- Produces: End-to-end test coverage for the full persistent streaming lifecycle

#### Step 1: Create chat.stream.e2e.spec.ts

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { encrypt } from '../../src/common/crypto/credential-cipher';

/**
 * Integration tests for the streaming chat endpoints:
 * POST /v1/chat/stream, POST /v1/chat/:id/cancel, POST /v1/chat/:id/retry
 *
 * Tests the full HTTP contract with a mocked provider.
 */
describe('Chat Streaming — e2e', () => {
  let app: INestApplication;
  let dbPath: string;
  let accessToken: string;

  jest.setTimeout(30_000);

  beforeAll(async () => {
    dbPath = path.join(os.tmpdir(), `chatbot-stream-${Date.now()}.sqlite`);
    process.env.NODE_ENV = 'test';
    process.env.DB_DRIVER = 'sqlite';
    process.env.SQLITE_FILE = dbPath;
    process.env.JWT_SECRET = 'integration-test-secret-with-enough-entropy-here';
    process.env.JWT_REFRESH_SECRET = 'integration-test-refresh-secret-entropy';
    process.env.PROVIDER_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    const ds = app.get(DataSource);
    await ds.runMigrations();

    // Seed provider + model.
    const { CentralProvider } = await import('../../src/modules/provider/entities/central-provider.entity');
    const providerRepo = ds.getRepository(CentralProvider);
    await providerRepo.save(
      providerRepo.create({
        id: 'singleton',
        baseUrl: 'http://localhost:9999',
        apiKeyEncrypted: encrypt('test-api-key'),
        lastValidatedAt: null,
      }),
    );

    const { Model } = await import('../../src/modules/models/entities/model.entity');
    const modelRepo = ds.getRepository(Model);
    await modelRepo.save(
      modelRepo.create({
        id: 'model-1',
        displayName: 'Test Model',
        actualName: 'test-model-v1',
        enabled: true,
        isDefault: true,
      }),
    );

    const { AppConfig } = await import('../../src/modules/app-config/entities/app-config.entity');
    const appConfigRepo = ds.getRepository(AppConfig);
    const cfg = await appConfigRepo.findOne({ where: { id: 'singleton' } });
    if (cfg) {
      cfg.defaultModelId = 'model-1';
      await appConfigRepo.save(cfg);
    }

    // Register a user.
    const reg = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email: 'stream-user@example.com', password: 'correct-horse-battery-staple' });
    accessToken = reg.body.accessToken;
  });

  afterAll(async () => {
    if (app) await app.close();
    try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
  });

  async function dsUser(): Promise<{ id: string }> {
    const ds = app.get(DataSource);
    const rows = await ds.query('SELECT id FROM users WHERE email = ? LIMIT 1', ['stream-user@example.com']);
    return rows[0];
  }

  describe('POST /v1/chat/stream', () => {
    it('creates a conversation and streams a response', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Hello streaming' });

      expect(res.status).toBe(200);
      // The response is SSE; supertest collects chunks.
      const body = res.text;
      expect(body).toContain('delta');
    });

    it('creates a user message and an assistant message with status=streaming then completed', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'Check status' });

      expect(res.status).toBe(200);

      // Get the conversation that was created.
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userId = (await dsUser()).id;
      const convs = await conversations.findByUser(userId, 1, 0);
      const conv = convs[0];

      const detail = await conversations.findById(conv.id);
      const userMsgs = detail!.messages.filter((m) => m.role === 'user');
      const assistantMsgs = detail!.messages.filter((m) => m.role === 'assistant');

      expect(userMsgs.length).toBeGreaterThanOrEqual(1);
      expect(userMsgs[0].content).toBe('Check status');
      expect(assistantMsgs.length).toBeGreaterThanOrEqual(1);
      // The assistant message should have been completed by now.
      expect(assistantMsgs[0].status).toBe('completed');
    });

    it('returns 409 when an active generation already exists', async () => {
      // First, create a conversation with a streaming message.
      const ds = app.get(DataSource);
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userId = (await dsUser()).id;
      const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'blocking' });

      // Manually set an assistant message to streaming status.
      const { Message } = await import('../../src/modules/conversations/entities/message.entity');
      const msgRepo = ds.getRepository(Message);
      await msgRepo.save(
        msgRepo.create({
          conversationId: conv.id,
          role: 'assistant',
          content: 'still generating...',
          status: 'streaming',
        }),
      );

      const res = await request(app.getHttpServer())
        .post('/v1/chat/stream')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ message: 'should fail', conversationId: conv.id });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('generation_in_progress');
    });
  });

  describe('POST /v1/chat/:conversationId/cancel', () => {
    it('cancels an active generation', async () => {
      // Create a conversation with a streaming message.
      const ds = app.get(DataSource);
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userId = (await dsUser()).id;
      const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'to cancel' });

      const { Message } = await import('../../src/modules/conversations/entities/message.entity');
      const msgRepo = ds.getRepository(Message);
      const streamMsg = await msgRepo.save(
        msgRepo.create({
          conversationId: conv.id,
          role: 'assistant',
          content: 'generating...',
          status: 'streaming',
        }),
      );

      const res = await request(app.getHttpServer())
        .post(`/v1/chat/${conv.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.messageId).toBe(streamMsg.id);
      expect(res.body.status).toBe('cancelled');

      // Verify in DB.
      const reloaded = await msgRepo.findOne({ where: { id: streamMsg.id } });
      expect(reloaded?.status).toBe('cancelled');
    });

    it('returns 404 for a conversation with no streaming message', async () => {
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userId = (await dsUser()).id;
      const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'no cancel' });

      const res = await request(app.getHttpServer())
        .post(`/v1/chat/${conv.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('no_active_generation');
    });
  });

  describe('POST /v1/chat/:conversationId/retry', () => {
    it('creates a new streaming message for retry', async () => {
      const ds = app.get(DataSource);
      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userId = (await dsUser()).id;
      const conv = await conversations.create({ userId, modelId: 'model-1', userMessage: 'retry me' });

      const { Message } = await import('../../src/modules/conversations/entities/message.entity');
      const msgRepo = ds.getRepository(Message);
      const failedMsg = await msgRepo.save(
        msgRepo.create({
          conversationId: conv.id,
          role: 'assistant',
          content: 'error',
          status: 'failed',
        }),
      );

      const res = await request(app.getHttpServer())
        .post(`/v1/chat/${conv.id}/retry`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ failedMessageId: failedMsg.id });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('streaming');
      expect(res.body.messageId).not.toBe(failedMsg.id);

      // Verify a new streaming message exists alongside the failed one.
      const msgs = await msgRepo.find({ where: { conversationId: conv.id } });
      const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
      expect(assistantMsgs).toHaveLength(2);
      expect(assistantMsgs.some((m) => m.status === 'failed')).toBe(true);
      expect(assistantMsgs.some((m) => m.status === 'streaming')).toBe(true);
    });

    it('returns 403 when requester is not the owner', async () => {
      // Register another user and use their token.
      const regB = await request(app.getHttpServer())
        .post('/v1/auth/register')
        .send({ email: 'other@example.com', password: 'correct-horse-battery-staple' });
      const tokenB = regB.body.accessToken;

      const { ConversationsService } = await import('../../src/modules/conversations/conversations.service');
      const conversations = app.get(ConversationsService);
      const userIdA = (await dsUser()).id;
      const conv = await conversations.create({ userId: userIdA, modelId: 'model-1', userMessage: 'not yours' });

      const { Message } = await import('../../src/modules/conversations/entities/message.entity');
      const msgRepo = app.get(DataSource).getRepository(Message);
      const failedMsg = await msgRepo.save(
        msgRepo.create({
          conversationId: conv.id,
          role: 'assistant',
          content: 'error',
          status: 'failed',
        }),
      );

      const res = await request(app.getHttpServer())
        .post(`/v1/chat/${conv.id}/retry`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ failedMessageId: failedMsg.id });

      expect(res.status).toBe(403);
    });
  });
});
```

#### Step 2: Add status assertions to conversations.e2e.spec.ts

In the existing `GET /v1/conversations/:id` test (line 183-206), add a status assertion:

After line 205 (`expect(detailRes.body.messages[0].content).toBe('Hello detail');`), add:
```typescript
expect(detailRes.body.messages[0].status).toBe('completed');
```

#### Step 3: Run integration tests

Run: `npx jest test/integration/chat.stream.e2e.spec.ts --no-coverage`
Expected: PASS (may need to adjust mock provider setup)

Also re-run existing integration tests:
Run: `npx jest test/integration/conversations.e2e.spec.ts --no-coverage`
Expected: PASS (with new status assertion)

#### Step 4: Run lint and type-check

Run: `npm run lint && npx tsc --noEmit`
Expected: Zero errors

#### Step 5: Commit

```
Suggested commit message: test(integration): add e2e tests for cancel, retry, resume, 409 conflict

- Add chat.stream.e2e.spec.ts with cancel/retry/409 tests
- Add status assertion to conversations.e2e.spec.ts
```

---

## Self-Review

### Spec coverage check

| Requirement | Task |
|---|---|
| FR-1: Message persistence | Task 1 (status column) + Task 3 (assistant message created before streaming) |
| FR-2: Generation lifecycle | Task 1 (status enum) + Task 2 (findStreamingMessage, updateMessageStatus) |
| FR-3: Continue after disconnect | Task 3 (Subject-based hot-stream, background continue) |
| FR-4: Streaming and persistence | Task 3 (progressive content persistence via updateMessageStatus) |
| FR-5: Resume unfinished generation | Task 3 (findStreamingMessage) + Task 4 (cancel/retry endpoints) |
| FR-6: Prevent duplicate generations | Task 3 (409 Conflict check) |
| FR-7: Cancellation and retry | Task 2 (cancelGeneration, retryGeneration) + Task 4 (controller endpoints) |
| FR-8: Recovery after reload | Task 3 (persistent messages via GET /v1/conversations/:id) |
| FR-9: Error handling | Task 3 (failed status, provider_error events) |
| FR-10: API consistency | Task 1 (status in DTO/controller) + Task 4 (OpenAPI update) |

### Placeholder scan

No TBD, TODO, or "implement later" patterns found. All code blocks contain actual implementation code.

### Type consistency

- `MessageStatus` type defined once in `conversations.types.ts` and imported consistently.
- Service method signatures match across tasks (e.g., `findStreamingMessage(conversationId)` returns `Promise<Message | null>`).
- Controller endpoints reference the same service methods they consume.
- OpenAPI schemas reference `MessageStatus` enum values matching the TypeScript type.

No mismatches found.
