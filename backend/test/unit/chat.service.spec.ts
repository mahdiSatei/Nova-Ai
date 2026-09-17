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

  // ─── client-disconnect resilience ─────────────────────────────────────

  describe('client disconnect mid-stream', () => {
    /**
     * Build an async iterable that yields the given chunks with a delay
     * between each, then signals done. The consumer side keeps reading
     * regardless of any subscriber state, mimicking the production
     * OpenAI SDK behavior under the new "don't abort" contract.
     */
    function buildSlowStream(chunks: string[], delayMs: number) {
      return (async function* () {
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, delayMs));
          yield { choices: [{ delta: { content: c } }] } as any;
        }
      })();
    }

    it('persists the FULL assistant response even when the client unsubscribes mid-stream', async () => {
      // Arrange
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });

      // Three chunks, 30 ms apart. After ~45 ms the first two have been
      // yielded; the test unsubscribes then and waits long enough for
      // the third to also be consumed and persisted.
      providerClient.stream.mockResolvedValue(
        buildSlowStream(['Hello', ' ', 'world'], 30),
      );

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const events: any[] = [];
      const sub = obs.subscribe({ next: (e) => events.push(e) });

      // Wait until at least one delta has been received.
      await new Promise((r) => setTimeout(r, 45));
      expect(events.some((e: any) => 'data' in e && !('event' in e))).toBe(true);

      // Simulate client disconnect.
      sub.unsubscribe();

      // Wait long enough for the consume loop to finish all three chunks
      // and the finally block to persist.
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the FULL response was persisted, not a truncated one.
      expect(conversations.appendMessage).toHaveBeenCalledTimes(1);
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', 'Hello world');
    });

    it('emits no SSE events to the observer after the client has unsubscribed', async () => {
      // Arrange
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-2', messages: [] });
      providerClient.stream.mockResolvedValue(
        buildSlowStream(['a', 'b', 'c', 'd'], 30),
      );

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const events: any[] = [];
      const sub = obs.subscribe({ next: (e) => events.push(e) });
      await new Promise((r) => setTimeout(r, 45));
      const eventsBeforeDisconnect = events.length;

      sub.unsubscribe();
      await new Promise((r) => setTimeout(r, 200));

      // Assert: no further events were emitted after unsubscribe.
      expect(events.length).toBe(eventsBeforeDisconnect);

      // Persistence still happened, with the full content.
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-2', 'abcd');
    });

    it('persists the partial response if the provider errors mid-stream after the client disconnected', async () => {
      // Arrange: a stream that yields one chunk, then throws a provider
      // error on the next iteration. The client is already gone when the
      // error fires.
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-3', messages: [] });

      const erroringStream = (async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] } as any;
        await new Promise((r) => setTimeout(r, 30));
        throw new Error('upstream blew up');
      })();
      providerClient.stream.mockResolvedValue(erroringStream);

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const sub = obs.subscribe({ next: () => {} });
      await new Promise((r) => setTimeout(r, 15));
      sub.unsubscribe();
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the partial content observed before the error was persisted.
      expect(conversations.appendMessage).toHaveBeenCalledTimes(1);
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-3', 'partial');
    });
  });
});
