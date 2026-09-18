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
        const msg = messages.find((m) => {
          if (opts.where.id && m.id !== opts.where.id) return false;
          if (opts.where.status && m.status !== opts.where.status) return false;
          if (opts.where.conversationId && m.conversationId !== opts.where.conversationId) return false;
          return true;
        });
        if (!msg) return Promise.resolve(null);
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
      const conv = await svc.create({ userId: 'u1', modelId: 'm1', userMessage: 'hi' });

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

  // NOTE: the old retryGeneration (which created a zombie 'streaming' row
  // without ever starting a generation) was removed. Retry now lives in
  // ChatService.retryGenerationStream — an SSE endpoint that runs the real
  // generation pipeline (see chat.service.spec.ts).
});
