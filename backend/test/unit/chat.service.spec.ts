import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ChatService, ChatDeltaEvent, ChatDoneEvent, ChatErrorEvent } from '../../src/modules/chat/chat.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { UsageService } from '../../src/modules/usage/usage.service';

describe('ChatService', () => {
  let svc: ChatService;
  let models: {
    resolveActiveModel: jest.Mock;
    findById: jest.Mock;
  };
  let runtime: {
    assertReady: jest.Mock;
    stream: jest.Mock;
  };
  let conversations: {
    create: jest.Mock;
    findById: jest.Mock;
    appendMessage: jest.Mock;
    findStreamingMessage: jest.Mock;
    updateMessageStatus: jest.Mock;
    findMessageById: jest.Mock;
    cancelGeneration: jest.Mock;
    retryGeneration: jest.Mock;
  };
  let userRepo: {
    update: jest.Mock;
  };
  let access: {
    loadViewer: jest.Mock;
    canAccess: jest.Mock;
    canAccessUser: jest.Mock;
    filterAccessible: jest.Mock;
    assertCanUseModel: jest.Mock;
  };

  beforeEach(async () => {
    models = { resolveActiveModel: jest.fn(), findById: jest.fn() };
    runtime = {
      assertReady: jest.fn().mockResolvedValue({
        provider: { id: 'p1', type: 'openai-compatible', baseUrl: 'https://example', apiKeyEncrypted: 'enc', isActive: true },
        adapter: { stream: jest.fn() },
      }),
      stream: jest.fn(),
    };
    conversations = {
      create: jest.fn(),
      findById: jest.fn(),
      appendMessage: jest.fn(),
      findStreamingMessage: jest.fn().mockResolvedValue(null),
      updateMessageStatus: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'streaming' }),
      findMessageById: jest.fn(),
      cancelGeneration: jest.fn(),
      retryGeneration: jest.fn(),
    };
    userRepo = { update: jest.fn() };
    access = {
      loadViewer: jest.fn().mockResolvedValue({ role: 'user', accessTier: 'free' }),
      canAccess: jest.fn().mockReturnValue(true),
      canAccessUser: jest.fn().mockResolvedValue(true),
      filterAccessible: jest.fn(async (_userId: string, models: any[]) => models),
      assertCanUseModel: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ModelsService, useValue: models },
        { provide: ProviderRuntimeService, useValue: runtime },
        { provide: ConversationsService, useValue: conversations },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ModelAccessService, useValue: access },
        { provide: UsageService, useValue: { create: jest.fn(async () => ({ id: 'usage-1' })), finalize: jest.fn(async () => {}) } },
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

  // ─── explicit modelId validation ────────────────────────────────────────

  describe('explicit modelId validation', () => {
    it('rejects stream request when explicit modelId is not found', async () => {
      models.findById.mockRejectedValue(new NotFoundException('Model not found'));

      const obs = svc.streamChat('user-1', { message: 'hi', modelId: 'nonexistent-model-id' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events).toEqual([
        { event: 'error', data: { code: 'model_unavailable', message: expect.any(String) } },
      ]);
    });

    it('rejects stream request when explicit modelId is disabled', async () => {
      models.findById.mockResolvedValue({
        id: 'm-disabled',
        displayName: 'Disabled',
        actualName: 'disabled-model',
        enabled: false,
        isDefault: false,
        providerId: 'p1',
      } as any);

      const obs = svc.streamChat('user-1', { message: 'hi', modelId: 'm-disabled' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events).toEqual([
        { event: 'error', data: { code: 'model_unavailable', message: expect.any(String) } },
      ]);
    });

    it('accepts stream request when explicit modelId is found and enabled', async () => {
      models.findById.mockResolvedValue({
        id: 'm1',
        displayName: 'GPT-4o',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
        providerId: 'p1',
      } as any);
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        isDefault: true,
        enabled: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });

      const asyncStream = (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] } as any;
      })();
      runtime.stream.mockResolvedValue(asyncStream);
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });

      const obs = svc.streamChat('user-1', { message: 'hi', modelId: 'm1' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      // Should get delta + done, not model_unavailable error.
      const errorEvents = events.filter((e: any) => e.event === 'error');
      expect(errorEvents).toHaveLength(0);
      expect(events.some((e: any) => e.data?.delta)).toBe(true);
    });

    it('falls back to sticky/default when no explicit modelId is provided', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm-default',
        actualName: 'gpt-4o',
        isDefault: true,
        enabled: true,
      } as any);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });

      const asyncStream = (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] } as any;
      })();
      runtime.stream.mockResolvedValue(asyncStream);
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });

      const obs = svc.streamChat('user-1', { message: 'hi' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      // resolveActiveModel should be called with null explicitModelId.
      expect(models.resolveActiveModel).toHaveBeenCalledWith({ explicitModelId: null, userId: 'user-1' });
      const errorEvents = events.filter((e: any) => e.event === 'error');
      expect(errorEvents).toHaveLength(0);
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

      runtime.stream.mockResolvedValue(asyncStream);
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });
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

      // appendMessage called with empty content (placeholder for streaming)
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', '');

      // updateMessageStatus called once for 'streaming' (no content), once for 'completed' (full content)
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'streaming');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'completed', 'Hello there!');

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
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });

      const asyncStream = (async function* () {
        yield { choices: [{ delta: { content: 'New answer' } }] } as any;
      })();
      runtime.stream.mockResolvedValue(asyncStream);

      const obs = svc.streamChat('user-1', { message: 'Follow-up', conversationId: 'conv-2' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      // provider stream called with (connection, { model, messages })
      expect(runtime.stream).toHaveBeenCalledWith(
        expect.objectContaining({ provider: expect.any(Object), adapter: expect.any(Object) }),
        {
          model: 'gpt-4o',
          messages: [
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
            { role: 'user', content: 'Follow-up' },
          ],
        },
      );

      // Status tracking: append with empty content, then update to completed
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-2', '');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'streaming');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'completed', 'New answer');
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
      conversations.findById.mockReturnValue({ id: 'conv-1', messages: [] });
      conversations.findStreamingMessage.mockResolvedValue(null);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1' });

      // Three chunks, 30 ms apart. After ~45 ms the first two have been
      // yielded; the test unsubscribes then and waits long enough for
      // the third to also be consumed and persisted.
      runtime.stream.mockResolvedValue(
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

      // Wait long enough for the consume loop to finish all three chunks.
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the FULL response was persisted via progressive updates.
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'completed', 'Hello world');
    });

    it('emits no SSE events to the observer after the client has unsubscribed', async () => {
      // Arrange
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({ id: 'conv-2', messages: [] });
      conversations.findStreamingMessage.mockResolvedValue(null);
      conversations.create.mockReturnValue({ id: 'conv-2', messages: [] });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-2' });
      runtime.stream.mockResolvedValue(
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

      // Persistence still happened via progressive status updates.
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-2', 'completed', 'abcd');
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
      conversations.findById.mockReturnValue({ id: 'conv-3', messages: [] });
      conversations.findStreamingMessage.mockResolvedValue(null);
      conversations.create.mockReturnValue({ id: 'conv-3', messages: [] });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-3' });

      const erroringStream = (async function* () {
        yield { choices: [{ delta: { content: 'partial' } }] } as any;
        await new Promise((r) => setTimeout(r, 30));
        throw new Error('upstream blew up');
      })();
      runtime.stream.mockResolvedValue(erroringStream);

      // Act
      const obs = svc.streamChat('user-1', { message: 'Hi' });
      const sub = obs.subscribe({ next: () => {} });
      await new Promise((r) => setTimeout(r, 15));
      sub.unsubscribe();
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the partial content observed before the error was persisted.
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-3', 'failed', 'partial');
    });
  });

  // ─── streaming status tracking ──────────────────────────────────────────

  describe('streaming status tracking', () => {
    it('returns 409 when an active generation already exists', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1', messages: [],
      });
      conversations.findStreamingMessage.mockResolvedValue({
        id: 'stream-msg', status: 'streaming',
      });

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({ next: (e) => events.push(e), complete: () => resolve() });
      });

      expect(events[0]).toEqual({
        event: 'error',
        data: { code: 'generation_in_progress', message: expect.any(String) },
      });
    });

    it('creates assistant message with status=streaming and updates to completed', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1', messages: [],
      });
      conversations.findStreamingMessage.mockResolvedValue(null);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });

      const asyncStream = (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] } as any;
      })();
      runtime.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      await new Promise<void>((resolve) => {
        obs.subscribe({ next: () => {}, complete: () => resolve() });
      });

      // appendMessage called with empty content, then updateMessageStatus
      // called with streaming (no content), then completed (full content).
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', '');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'streaming');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'completed', 'hi');
    });

    it('updates message status to failed on provider error', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1', messages: [],
      });
      conversations.findStreamingMessage.mockResolvedValue(null);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });
      runtime.stream.mockRejectedValue(new Error('provider down'));

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({ next: (e) => events.push(e), complete: () => resolve() });
      });

      expect(events[0]).toEqual({
        event: 'error',
        data: { code: 'provider_error', message: expect.any(String) },
      });
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'failed', '');
    });
  });

  // ─── explicit model entitlement (phase 3) ────────────────────────────────

  describe('explicit model entitlement', () => {
    it('emits model_forbidden when the model exists but the caller is not entitled', async () => {
      models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });
      access.canAccessUser.mockResolvedValue(false);

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'com' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events).toContainEqual({
        event: 'error',
        data: expect.objectContaining({ code: 'model_forbidden' }),
      });
      expect(conversations.create).not.toHaveBeenCalled();
    });

    it('keeps model_unavailable for a disabled model (no entitlement leak)', async () => {
      models.findById.mockResolvedValue({ id: 'off', enabled: false, visibility: 'public' });
      access.canAccessUser.mockResolvedValue(false);

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'off' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events).toContainEqual({
        event: 'error',
        data: expect.objectContaining({ code: 'model_unavailable' }),
      });
    });

    it('proceeds for an entitled explicit model', async () => {
      models.findById.mockResolvedValue({ id: 'pub', enabled: true, visibility: 'public' });
      access.canAccessUser.mockResolvedValue(true);
      conversations.create.mockReturnValue({ id: 'conv-1', messages: [] });

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'pub' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events.some((e: any) => e?.event === 'error' && e.data.code === 'model_forbidden')).toBe(
        false,
      );
    });
  });
});
