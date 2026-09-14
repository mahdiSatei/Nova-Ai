import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from '../../src/modules/chat/chat.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { OpenAICompatibleClient } from '../../src/modules/chat/provider/openai-compatible.client';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { User } from '../../src/modules/users/entities/user.entity';

describe('ChatService', () => {
  let svc: ChatService;
  let models: {
    resolveActiveModel: jest.Mock;
  };
  let providerClient: {
    getClient: jest.Mock;
    stream: jest.Mock;
  };
  let conversations: {
    create: jest.Mock;
    findById: jest.Mock;
    appendMessage: jest.Mock;
  };
  let userRepo: {
    update: jest.Mock;
  };

  beforeEach(async () => {
    models = { resolveActiveModel: jest.fn() };
    providerClient = {
      getClient: jest.fn().mockResolvedValue({}),
      stream: jest.fn(),
    };
    conversations = {
      create: jest.fn(),
      findById: jest.fn(),
      appendMessage: jest.fn(),
    };
    userRepo = { update: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ModelsService, useValue: models },
        { provide: OpenAICompatibleClient, useValue: providerClient },
        { provide: ConversationsService, useValue: conversations },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    svc = moduleRef.get(ChatService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── no model available ────────────────────────────────────────────────

  describe('when no model is resolvable', () => {
    it('returns an error event with code no_model_available', async () => {
      models.resolveActiveModel.mockResolvedValue(null);

      const obs = svc.streamChat('user-1', { message: 'hello' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events.length).toBe(1);
      expect(events[0]).toEqual({
        event: 'error',
        data: { code: 'no_model_available', message: expect.any(String) },
      });
    });
  });

  // ─── message validation ────────────────────────────────────────────────

  describe('message validation (FR-014)', () => {
    it('returns error for empty message', async () => {
      models.resolveActiveModel.mockResolvedValue({ id: 'm1', actualName: 'gpt' } as any);

      const obs = svc.streamChat('user-1', { message: '' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events[0]).toEqual({
        event: 'error',
        data: { code: 'invalid_message', message: expect.any(String) },
      });
    });
  });

  // ─── happy path: new conversation ──────────────────────────────────────

  describe('happy path — new conversation', () => {
    const setupStream = () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        isDefault: true,
        enabled: true,
      } as any);
      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      const chunks = ['Hello', ' there', '!'];
      const asyncStream = (async function* () {
        for (const c of chunks) {
          yield { choices: [{ delta: { content: c } }] } as any;
        }
      })();

      providerClient.stream.mockResolvedValue(asyncStream);
    };

    it('creates a conversation and streams tokens', async () => {
      setupStream();

      const obs = svc.streamChat('user-1', { message: 'Hi there' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      // conversations.create called with correct args
      expect(conversations.create).toHaveBeenCalledWith({
        userId: 'user-1',
        modelId: 'm1',
        userMessage: 'Hi there',
      });

      // appendMessage called with the assistant's full response
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', 'Hello there!');

      // Token events + done event
      const deltaEvents = events.filter((e) => 'data' in e && !('event' in e));
      expect(deltaEvents.map((e: any) => e.data.delta).join('')).toBe('Hello there!');
      expect(events[events.length - 1]).toEqual({ event: 'done', data: {} });

      // userRepo.update called to persist sticky choice
      expect(userRepo.update).toHaveBeenCalledWith({ id: 'user-1' }, { lastSelectedModelId: 'm1' });
    });
  });

  // ─── existing conversation ─────────────────────────────────────────────

  describe('existing conversation', () => {
    it('resumes the conversation with prior turns', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        isDefault: true,
        enabled: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-2',
        messages: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
        ],
      });

      const asyncStream = (async function* () {
        yield { choices: [{ delta: { content: 'New answer' } }] } as any;
      })();
      providerClient.stream.mockResolvedValue(asyncStream);

      const obs = svc.streamChat('user-1', { message: 'Follow-up', conversationId: 'conv-2' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      // provider stream got prior turns + new message
      expect(providerClient.stream).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
          { role: 'user', content: 'Follow-up' },
        ],
      });

      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-2', 'New answer');
    });
  });
});
