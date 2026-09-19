import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { ChatService, ChatDeltaEvent, ChatDoneEvent, ChatErrorEvent } from '../../src/modules/chat/chat.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import {
  ProviderFailoverService,
  AllProvidersUnavailableError,
} from '../../src/modules/provider/provider-failover.service';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { WebSearchService } from '../../src/modules/web-search/web-search.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { UsageService } from '../../src/modules/usage/usage.service';
import { QuotaService } from '../../src/modules/quotas/quotas.service';

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
  let failover: { establish: jest.Mock };
  let conversations: {
    create: jest.Mock;
    findById: jest.Mock;
    appendMessage: jest.Mock;
    appendUserMessage: jest.Mock;
    findStreamingMessage: jest.Mock;
    updateMessageStatus: jest.Mock;
    completeIfStreaming: jest.Mock;
    findMessageById: jest.Mock;
    cancelGeneration: jest.Mock;
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
    // Phase 6: establishment is a *selection* step. It decides which model
    // serves the turn, honours the caller's entitlement predicate (awaited,
    // exactly like the real service), and reports the attempt count. The stream
    // the caller actually consumes is opened by ChatService itself, so tests
    // drive content through `runtime.stream`.
    failover = {
      establish: jest.fn(
        async (input: {
          model: any;
          messages: any[];
          isAllowed?: (model: any) => boolean | Promise<boolean>;
        }) => {
          const allowed =
            input.model.enabled !== false &&
            (!input.isAllowed || (await input.isAllowed(input.model)));

          if (!allowed) {
            // No candidate is reachable for this caller: the same error the
            // real service raises when candidate resolution comes up empty.
            throw new AllProvidersUnavailableError(
              [
                {
                  modelId: input.model.id,
                  providerId: input.model.providerId,
                  attempt: 0,
                  code: 'model_unavailable',
                  category: 'configuration',
                  durationMs: 0,
                },
              ],
              0,
            );
          }

          return {
            model: input.model,
            connection: {},
            stream: (async function* () {
              /* opened then superseded by the consumed stream */
            })(),
            attempts: 1,
            failures: [],
          };
        },
      ),
    };
    conversations = {
      create: jest.fn(),
      findById: jest.fn(),
      appendMessage: jest.fn(),
      appendUserMessage: jest.fn().mockResolvedValue({ id: 'um-1' }),
      findStreamingMessage: jest.fn().mockResolvedValue(null),
      updateMessageStatus: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'streaming' }),
      completeIfStreaming: jest.fn().mockResolvedValue(true),
      findMessageById: jest.fn(),
      cancelGeneration: jest.fn(),
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
        { provide: ProviderFailoverService, useValue: failover },
        { provide: ConversationsService, useValue: conversations },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ModelAccessService, useValue: access },
        { provide: UsageService, useValue: { create: jest.fn(async () => ({ id: 'usage-1' })), finalize: jest.fn(async () => {}) } },
        {
          provide: QuotaService,
          useValue: {
            checkAndReserve: jest.fn(async () => ({
              reserved: true,
              quotaId: 'quota-1',
              tokenRemaining: 100000,
            })),
            finalize: jest.fn(async () => {}),
            refund: jest.fn(async () => {}),
          },
        },
        {
          provide: WebSearchService,
          useValue: { isConfigured: () => true, search: jest.fn() },
        },
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
        type: 'error',
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
        { type: 'error', data: { code: 'model_unavailable', message: expect.any(String) } },
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
        { type: 'error', data: { code: 'model_unavailable', message: expect.any(String) } },
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
      const errorEvents = events.filter((e: any) => e.type === 'error');
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
      const errorEvents = events.filter((e: any) => e.type === 'error');
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
        type: 'error',
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

      // updateMessageStatus called once for 'streaming' (no content);
      // completion goes through the atomic completeIfStreaming write.
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'streaming');
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'Hello there!', [], {
        enabled: false,
        summary: null,
      });

      // First event is the start event with real ids.
      expect(events[0]).toEqual({
        type: 'start',
        data: { conversationId: 'conv-1', assistantMessageId: 'msg-1' },
      });

      // Token events + done event
      const deltaEvents = events.filter((e) => 'data' in e && !('type' in e));
      expect(deltaEvents.map((e: any) => e.data.delta).join('')).toBe('Hello there!');
      expect(events[events.length - 1]).toEqual({ type: 'done', data: {} });

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
        userId: 'user-1',
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

      // provider stream got prior turns + new message. The first argument is
      // the provider connection resolved by the runtime; cancellation is
      // signalled through the stream's own abort handling.
      expect(runtime.stream).toHaveBeenCalledWith(
        expect.objectContaining({ provider: expect.anything() }),
        {
          model: 'gpt-4o',
          messages: [
            { role: 'user', content: 'Previous question' },
            { role: 'assistant', content: 'Previous answer' },
            { role: 'user', content: 'Follow-up' },
          ],
        },
      );

      // Status tracking: append with empty content, then complete atomically.
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-2', '');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'streaming');
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'New answer', [], {
        enabled: false,
        summary: null,
      });

      // The turn's user message is persisted so it survives reloads.
      expect(conversations.appendUserMessage).toHaveBeenCalledWith('conv-2', 'Follow-up');
    });
  });

  // ─── client-disconnect resilience ──────────────────────────────────────

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
      expect(events.some((e: any) => 'data' in e && !('type' in e))).toBe(true);

      // Simulate client disconnect.
      sub.unsubscribe();

      // Wait long enough for the consume loop to finish all three chunks.
      await new Promise((r) => setTimeout(r, 200));

      // Assert: the FULL response was persisted via the atomic completion write.
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'Hello world', [], {
        enabled: false,
        summary: null,
      });
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

      // Persistence still happened via the atomic completion write.
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-2', 'abcd', [], {
        enabled: false,
        summary: null,
      });
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

  // ─── streaming status tracking ────────────────────────────────────────

  describe('streaming status tracking', () => {
    it('returns 409 when an active generation already exists', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1', userId: 'user-1', messages: [],
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
        type: 'error',
        data: { code: 'generation_in_progress', message: expect.any(String) },
      });
    });

    it('creates assistant message with status=streaming and updates to completed', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1', userId: 'user-1', messages: [],
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

      // appendMessage called with empty content, updateMessageStatus with
      // streaming (no content), then the atomic completion write.
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', '');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'streaming');
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'hi', [], {
        enabled: false,
        summary: null,
      });
    });

    // ChatService opens the consumed stream itself, so a failure while opening
    // it surfaces as a provider error on an already-started turn. (Employing
    // *no* reachable candidate is what surfaces as all_providers_unavailable.)
    it('updates message status to failed when every provider candidate fails', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1', userId: 'user-1', messages: [],
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

      // start is emitted before the provider stream is opened, then the
      // provider rejection surfaces as an error event.
      expect(events[0]).toEqual({
        type: 'start',
        data: { conversationId: 'conv-1', assistantMessageId: 'msg-1' },
      });
      expect(events[1]).toEqual({
        type: 'error',
        data: { code: 'provider_error', message: expect.any(String) },
      });
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'failed', '');
    });
  });

  // ─── explicit model entitlement (phase 3) ────────────────────────────────

  describe('explicit model entitlement', () => {
    // The public 403 `model_forbidden` mapping lives in the HTTP layer
    // (ModelAccessService.assertCanUseModel, used by the conversations and
    // users controllers). The chat SSE path guarantees the weaker but
    // sufficient property that an unentitled model is never used, without
    // revealing whether the caller was refused for entitlement or for
    // availability.
    //
    // Known wart, recorded here so it is visible rather than assumed: the
    // conversation and its assistant row are created *before* candidate
    // resolution decides the model is unusable, so a refused turn still leaves
    // a conversation behind (stamped with the refused model id) and a failed
    // assistant row. Tightening that ordering is a separate change.
    it('never uses an explicit model the caller is not entitled to', async () => {
      models.findById.mockResolvedValue({ id: 'com', enabled: true, visibility: 'commercial' });
      access.canAccessUser.mockResolvedValue(false);
      conversations.create.mockReturnValue({ id: 'conv-new', messages: [] });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-new', status: 'streaming' });

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'com' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 20));
      expect(events).toContainEqual({
        type: 'error',
        data: expect.objectContaining({ code: 'all_providers_unavailable' }),
      });
      // The entitlement predicate was consulted, no provider call was made, and
      // the assistant row was not left dangling in `streaming`.
      expect(access.canAccessUser).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ id: 'com' }),
      );
      expect(runtime.stream).not.toHaveBeenCalled();
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-new', 'failed', '');
    });

    it('keeps model_unavailable for a disabled model (no entitlement leak)', async () => {
      models.findById.mockResolvedValue({ id: 'off', enabled: false, visibility: 'public' });
      access.canAccessUser.mockResolvedValue(false);

      const events: any[] = [];
      svc.streamChat('user-1', { message: 'hi', modelId: 'off' }).subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));
      expect(events).toContainEqual({
        type: 'error',
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
      expect(events.some((e: any) => e?.type === 'error' && e.data.code === 'model_forbidden')).toBe(
        false,
      );
    });
  });

  // ─── cancellation ──────────────────────────────────────────────────────

  describe('cancellation', () => {
    const setupActiveStream = () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({ id: 'conv-1', userId: 'user-1', messages: [] });
      // runStream's generation_in_progress check must pass (no streaming
      // row yet); cancelGeneration's lookup happens later and needs one.
      conversations.findStreamingMessage
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'msg-1', status: 'streaming' });
      conversations.cancelGeneration.mockResolvedValue({ id: 'msg-1', status: 'cancelled' });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });
      runtime.stream.mockResolvedValue(
        (async function* () {
          for (const c of ['Hello', ' ', 'world']) {
            yield { choices: [{ delta: { content: c } }] } as any;
            await new Promise((r) => setTimeout(r, 20));
          }
        })(),
      );
    };

    it('broadcasts generation_cancelled to subscribers when cancelled mid-stream', async () => {
      setupActiveStream();

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      const events: any[] = [];
      obs.subscribe({ next: (e) => events.push(e) });

      // Wait until at least one delta has been emitted.
      await new Promise((r) => setTimeout(r, 50));
      expect(events.some((e: any) => 'data' in e && !('type' in e))).toBe(true);

      await svc.cancelGeneration('conv-1', 'user-1');

      const cancelEvents = events.filter(
        (e: any) => e.type === 'error' && e.data?.code === 'generation_cancelled',
      );
      expect(cancelEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('never resurrects a cancelled message to completed', async () => {
      setupActiveStream();
      // The DB row is 'cancelled', so the conditional completion write
      // affects zero rows and returns false.
      conversations.completeIfStreaming.mockResolvedValue(false);

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      const events: any[] = [];
      obs.subscribe({ next: (e) => events.push(e) });

      await new Promise((r) => setTimeout(r, 50));
      await svc.cancelGeneration('conv-1', 'user-1');

      // Give the consume loop time to finish (the mock stream ignores
      // the abort signal, mimicking a slow provider teardown).
      await new Promise((r) => setTimeout(r, 150));

      expect(conversations.updateMessageStatus).not.toHaveBeenCalledWith(
        'msg-1',
        'completed',
        expect.anything(),
      );
      expect(
        events.some((e: any) => e.type === 'done'),
      ).toBe(false);
    });

    it('aborts a stream cancelled before it was registered (pre-first-token window)', async () => {
      setupActiveStream();

      // Cancel lands BEFORE the stream starts: the cancel's own lookup
      // must find the streaming row, while runStream's in-progress check
      // (later) must not — reverse the sequence used above.
      conversations.findStreamingMessage
        .mockReset()
        .mockResolvedValueOnce({ id: 'msg-1', status: 'streaming' })
        .mockResolvedValue(null);

      // activeStreams is empty, so the cancel is parked in pendingCancels
      // keyed by the message id.
      await svc.cancelGeneration('conv-1', 'user-1');
      expect(conversations.cancelGeneration).toHaveBeenCalledWith(
        'conv-1', 'msg-1', 'user-1',
      );

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      const events: any[] = [];
      await new Promise<void>((resolve) => {
        obs.subscribe({ next: (e) => events.push(e), complete: () => resolve() });
      });

      // The start event goes out, then the parked cancel aborts the
      // stream — no deltas ever reach the subscriber.
      expect(events.some((e: any) => e.type === 'start')).toBe(true);
      expect(events.some((e: any) => 'data' in e && !('type' in e))).toBe(false);
      expect(
        events.some(
          (e: any) => e.type === 'error' && e.data?.code === 'generation_cancelled',
        ),
      ).toBe(true);
      expect(conversations.updateMessageStatus).not.toHaveBeenCalledWith(
        'msg-1',
        'completed',
        expect.anything(),
      );
    });
  });

  // ─── retry pipeline (SSE) ──────────────────────────────────────────────

  describe('retryGenerationStream', () => {
    const setupRetry = () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [
          { id: 'u1', role: 'user', content: 'hi', status: 'completed' },
          { id: 'm-failed', role: 'assistant', content: '', status: 'failed' },
        ],
      });
      conversations.findStreamingMessage.mockResolvedValue(null);
      conversations.appendMessage.mockResolvedValue({ id: 'msg-new', status: 'streaming' });
      runtime.stream.mockResolvedValue(
        (async function* () {
          yield { choices: [{ delta: { content: 'retry' } }] } as any;
          yield { choices: [{ delta: { content: ' works' } }] } as any;
        })(),
      );
    };

    const collect = async (obs: ReturnType<ChatService['retryGenerationStream']>) => {
      const events: any[] = [];
      await new Promise<void>((resolve) => {
        obs.subscribe({ next: (e) => events.push(e), complete: () => resolve() });
      });
      return events;
    };

    it('starts a REAL generation for the failed message and streams it', async () => {
      setupRetry();

      const events = await collect(svc.retryGenerationStream('user-1', 'conv-1', 'm-failed'));

      // start event with the NEW assistant message id, then deltas + done.
      expect(events[0]).toEqual({
        type: 'start',
        data: { conversationId: 'conv-1', assistantMessageId: 'msg-new' },
      });
      const deltas = events.filter((e) => 'data' in e && !('type' in e));
      expect(deltas.map((e: any) => e.data.delta).join('')).toBe('retry works');
      expect(events[events.length - 1]).toEqual({ type: 'done', data: {} });

      // The retried message is excluded from context; prior good turns stay.
      expect(runtime.stream).toHaveBeenCalledWith(
        expect.objectContaining({ provider: expect.anything() }),
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'hi' }],
        },
      );
      // Completion goes through the atomic write.
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-new', 'retry works', [], {
        enabled: false,
        summary: null,
      });
    });

    it('rejects retrying a message that is not failed/cancelled', async () => {
      setupRetry();
      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [
          { id: 'm-ok', role: 'assistant', content: 'fine', status: 'completed' },
        ],
      });

      const events = await collect(svc.retryGenerationStream('user-1', 'conv-1', 'm-ok'));

      expect(events).toEqual([
        { type: 'error', data: { code: 'message_not_retryable', message: expect.any(String) } },
      ]);
      expect(runtime.stream).not.toHaveBeenCalled();
      expect(conversations.appendMessage).not.toHaveBeenCalled();
    });

    it('refuses to retry while another generation is in progress', async () => {
      setupRetry();
      conversations.findStreamingMessage.mockResolvedValue({ id: 'busy', status: 'streaming' });

      const events = await collect(svc.retryGenerationStream('user-1', 'conv-1', 'm-failed'));

      expect(events[0].type).toBe('error');
      expect(events[0].data.code).toBe('generation_in_progress');
      expect(conversations.appendMessage).not.toHaveBeenCalled();
    });
  });
});