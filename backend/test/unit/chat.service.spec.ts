import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService, ChatDeltaEvent, ChatDoneEvent, ChatErrorEvent } from '../../src/modules/chat/chat.service';
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
      appendUserMessage: jest.fn().mockResolvedValue({ id: 'um-1' }),
    findStreamingMessage: jest.fn().mockResolvedValue(null),
    updateMessageStatus: jest.fn().mockResolvedValue({ id: 'msg-1', status: 'streaming' }),
    completeIfStreaming: jest.fn().mockResolvedValue(true),
    findMessageById: jest.fn(),
      cancelGeneration: jest.fn(),
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
        type: 'error',
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

      providerClient.stream.mockResolvedValue(asyncStream);
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
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'Hello there!');

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
        messages: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
        ],
      });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });

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

      // provider stream got prior turns + new message, plus the abort
      // signal used for user-initiated cancellation.
      expect(providerClient.stream).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'Previous question' },
          { role: 'assistant', content: 'Previous answer' },
          { role: 'user', content: 'Follow-up' },
        ],
        signal: expect.any(AbortSignal),
      });

      // Status tracking: append with empty content, then complete atomically.
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-2', '');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith(expect.any(String), 'streaming');
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'New answer');

      // The turn's user message is persisted so it survives reloads.
      expect(conversations.appendUserMessage).toHaveBeenCalledWith('conv-2', 'Follow-up');
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
      providerClient.stream.mockResolvedValue(
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
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'Hello world');
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

      // Persistence still happened via the atomic completion write.
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-2', 'abcd');
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
      providerClient.stream.mockResolvedValue(erroringStream);

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
        type: 'error',
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
      providerClient.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });

      const obs = svc.streamChat('user-1', { message: 'hi', conversationId: 'conv-1' });
      await new Promise<void>((resolve) => {
        obs.subscribe({ next: () => {}, complete: () => resolve() });
      });

      // appendMessage called with empty content, updateMessageStatus with
      // streaming (no content), then the atomic completion write.
      expect(conversations.appendMessage).toHaveBeenCalledWith('conv-1', '');
      expect(conversations.updateMessageStatus).toHaveBeenCalledWith('msg-1', 'streaming');
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-1', 'hi');
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
      providerClient.stream.mockRejectedValue(new Error('provider down'));

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

  // ─── cancellation ──────────────────────────────────────────────────────

  describe('cancellation', () => {
    const setupActiveStream = () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1', actualName: 'gpt-4o', enabled: true, isDefault: true,
      } as any);
      conversations.findById.mockReturnValue({ id: 'conv-1', messages: [] });
      // runStream's generation_in_progress check must pass (no streaming
      // row yet); cancelGeneration's lookup happens later and needs one.
      conversations.findStreamingMessage
        .mockResolvedValueOnce(null)
        .mockResolvedValue({ id: 'msg-1', status: 'streaming' });
      conversations.cancelGeneration.mockResolvedValue({ id: 'msg-1', status: 'cancelled' });
      conversations.appendMessage.mockResolvedValue({ id: 'msg-1', status: 'streaming' });
      providerClient.stream.mockResolvedValue(
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

  // ─── retry pipeline (SSE) ───────────────────────────────────────────────

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
      providerClient.stream.mockResolvedValue(
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
      expect(providerClient.stream).toHaveBeenCalledWith({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        signal: expect.any(AbortSignal),
      });
      // Completion goes through the atomic write.
      expect(conversations.completeIfStreaming).toHaveBeenCalledWith('msg-new', 'retry works');
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
      expect(providerClient.stream).not.toHaveBeenCalled();
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
