import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { Conversation } from '../../src/modules/conversations/entities/conversation.entity';
import { Message } from '../../src/modules/conversations/entities/message.entity';

describe('ConversationsService', () => {
  let svc: ConversationsService;
  let conversationRepo: any;
  let messageRepo: any;

  beforeEach(async () => {
    // In-memory state shared across mock implementations.
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
        return Promise.resolve({ ...conv, messages: msgs });
      }),
      find: jest.fn(() => Promise.resolve(Array.from(conversations.values()).reverse())),
      update: jest.fn(() => Promise.resolve({ affected: 1 })),
      delete: jest.fn(() => Promise.resolve({ affected: 1 })),
    };

    messageRepo = {
      create: jest.fn((dto: any) => ({ ...dto, id: 'm-' + (++nextMsgId) })),
      save: jest.fn((msg: any) => {
        messages.push(msg);
        return Promise.resolve(msg);
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

  // ─── create ────────────────────────────────────────────────────────────

  describe('create', () => {
    it('creates a conversation and persists the first user message', async () => {
      const result = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'Hello world' });

      // create called with correct fields.
      expect(conversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', modelId: 'm1', title: 'Hello world' }),
      );
      // save called with the created entity.
      expect(conversationRepo.save).toHaveBeenCalled();
      const savedArg = (conversationRepo.save.mock.calls[0] as any[])[0];
      expect(savedArg.userId).toBe('u1');
      expect(savedArg.modelId).toBe('m1');
      expect(savedArg.title).toBe('Hello world');
      // message saved with conversation id.
      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: result.id, role: 'user', content: 'Hello world' }),
      );
      expect(result.messages).toHaveLength(1);
    });

    it('generates a title for a standard message', async () => {
      const msg = 'سلام چطوری؟';
      await svc.create({ userId: 'u1', modelId: 'm1', userMessage: msg });

      const created = (conversationRepo.create.mock.calls[0] as any[])[0];
      expect(created.title).toBe('سلام چطوری'); // Should remove '؟'
    });
  });

  // ─── findById ──────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns a conversation with messages when found', async () => {
      // Seed a conversation + message via the service itself.
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });
      const result = await svc.findById(conv.id);
      expect(result).not.toBeNull();
      expect(result?.messages).toHaveLength(1);
    });

    it('returns null when conversation does not exist', async () => {
      const result = await svc.findById('missing');
      expect(result).toBeNull();
    });
  });

  // ─── findByUser ────────────────────────────────────────────────────────

  describe('findByUser', () => {
    it('returns conversations with correct query params', async () => {
      await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      const result = await svc.findByUser('u1', 10, 0);

      expect(conversationRepo.find).toHaveBeenCalledWith({
        where: { userId: 'u1' },
        order: { pinned: 'DESC', updatedAt: 'DESC' },
        take: 10,
        skip: 0,
      });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── appendMessage ─────────────────────────────────────────────────────

  describe('appendMessage', () => {
    it('appends a message and updates the conversation timestamp', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      const result = await svc.appendMessage(conv.id, 'reply');

      expect(messageRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ conversationId: conv.id, role: 'assistant', content: 'reply' }),
      );
      expect(conversationRepo.update).toHaveBeenCalledWith(conv.id, { updatedAt: expect.any(Date) });
      expect(result?.content).toBe('reply');
    });

    it('returns undefined when conversation does not exist', async () => {
      const result = await svc.appendMessage('missing', 'reply');
      expect(result).toBeUndefined();
    });
  });

  // ─── setPinned ─────────────────────────────────────────────────────────

  describe('setPinned', () => {
    it('updates the pin flag when the requester is the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      const result = await svc.setPinned(conv.id, 'u1', true);

      expect(conversationRepo.update).toHaveBeenCalledWith(conv.id, { pinned: true });
      expect(result).not.toBeNull();
      expect(result?.pinned).toBe(true);
    });

    it('can unpin an existing conversation', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      const result = await svc.setPinned(conv.id, 'u1', false);

      expect(conversationRepo.update).toHaveBeenCalledWith(conv.id, { pinned: false });
      expect(result?.pinned).toBe(false);
    });

    it('returns null when conversation does not exist', async () => {
      const result = await svc.setPinned('missing', 'u1', true);
      expect(result).toBeNull();
      expect(conversationRepo.update).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when requester is not the owner', async () => {
      const conv = await svc.create({ userId: 'u2', modelId: 'm1', userMessage: 'hi' });

      expect(svc.setPinned(conv.id, 'u1', true)).rejects.toBeInstanceOf(ForbiddenException);
      expect(conversationRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── setModel ──────────────────────────────────────────────────────────

  describe('setModel', () => {
    it('updates the model id when the caller is the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      const updated = await svc.setModel(conv.id, 'u1', 'm2');

      expect(conversationRepo.update).toHaveBeenCalledWith(conv.id, { modelId: 'm2' });
      expect(updated).not.toBeNull();
    });

    it('throws ForbiddenException when caller is not the owner', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      await expect(svc.setModel(conv.id, 'someone-else', 'm2')).rejects.toBeInstanceOf(ForbiddenException);
      expect(conversationRepo.update).not.toHaveBeenCalled();
    });

    it('returns null when the conversation does not exist', async () => {
      const result = await svc.setModel('c-missing', 'u1', 'm2');
      expect(result).toBeNull();
      expect(conversationRepo.update).not.toHaveBeenCalled();
    });
  });

  // ─── delete ────────────────────────────────────────────────────────────

  describe('delete', () => {
    it('deletes the conversation when owner matches', async () => {
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

      const result = await svc.delete(conv.id, 'u1');
      expect(result).toBe(true);
      expect(conversationRepo.delete).toHaveBeenCalledWith(conv.id);
    });

    it('returns false when conversation does not exist', async () => {
      const result = await svc.delete('missing', 'u1');
      expect(result).toBe(false);
    });

    it('throws ConflictException when requester is not the owner', async () => {
      const conv = await svc.create({ userId: 'u2', modelId: 'm1', userMessage: 'hi' });

      expect(svc.delete(conv.id, 'u1')).rejects.toBeInstanceOf(ConflictException);
      expect(conversationRepo.delete).not.toHaveBeenCalled();
    });
  });
});
