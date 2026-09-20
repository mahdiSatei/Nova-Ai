import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import {
  ChatService,
  ChatDeltaEvent,
  ChatDoneEvent,
  ChatErrorEvent,
} from '../../src/modules/chat/chat.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import {
  ProviderFailoverService,
  AllProvidersUnavailableError,
} from '../../src/modules/provider/provider-failover.service';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { WebSearchService } from '../../src/modules/web-search/web-search.service';
import { FilesService } from '../../src/modules/files/files.service';
import { User } from '../../src/modules/users/entities/user.entity';
import { UsageService } from '../../src/modules/usage/usage.service';
import { UsagePricingService } from '../../src/modules/billing/usage-pricing.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';

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

  let files: {
    findOwned: jest.Mock;
  };

  beforeEach(async () => {
    models = {
      resolveActiveModel: jest.fn(),
      findById: jest.fn(),
    };

    runtime = {
      assertReady: jest.fn().mockResolvedValue({
        provider: {
          id: 'p1',
          type: 'openai-compatible',
          baseUrl: 'https://example',
          apiKeyEncrypted: 'enc',
          isActive: true,
        },
        adapter: {
          stream: jest.fn(),
        },
      }),
      stream: jest.fn(),
    };

    // Phase 6: establishment is a selection step. It decides which model
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
      updateMessageStatus: jest
        .fn()
        .mockResolvedValue({ id: 'msg-1', status: 'streaming' }),
      completeIfStreaming: jest.fn().mockResolvedValue(true),
      findMessageById: jest.fn(),
      cancelGeneration: jest.fn(),
    };

    userRepo = {
      update: jest.fn(),
    };

    access = {
      loadViewer: jest.fn().mockResolvedValue({
        role: 'user',
      }),
      canAccess: jest.fn().mockReturnValue(true),
      canAccessUser: jest.fn().mockResolvedValue(true),
      filterAccessible: jest.fn(
        async (_userId: string, models: any[]) => models,
      ),
      assertCanUseModel: jest.fn().mockResolvedValue(undefined),
    };

    files = {
      findOwned: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ModelsService, useValue: models },
        { provide: ProviderRuntimeService, useValue: runtime },
        { provide: ProviderFailoverService, useValue: failover },
        { provide: ConversationsService, useValue: conversations },
        { provide: FilesService, useValue: files },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: ModelAccessService, useValue: access },
        {
          provide: UsageService,
          useValue: {
            create: jest.fn(async () => ({ id: 'usage-1' })),
            finalizeOnce: jest.fn(async () => true),
          },
        },
        {
          provide: UsagePricingService,
          useValue: {
            calculateLlmCost: jest.fn(async () => ({ chargedCost: 0, chargedCredits: 0 })),
            getOutputCreditRate: jest.fn().mockResolvedValue(0),
          },
        },
        {
          provide: WalletService,
          useValue: {
            getBalance: jest.fn().mockResolvedValue(0),
            deductCreditsWithGrace: jest.fn(),
            grantCredits: jest.fn(),
          },
        },
        {
          provide: WebSearchService,
          useValue: {
            isConfigured: () => true,
            search: jest.fn(),
          },
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
        data: {
          code: 'no_model_available',
          message: expect.any(String),
        },
      });
    });
  });

  // ─── explicit modelId validation ───────────────────────────────────────

  describe('explicit modelId validation', () => {
    it('rejects stream request when explicit modelId is not found', async () => {
      models.findById.mockRejectedValue(
        new NotFoundException('Model not found'),
      );

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        modelId: 'nonexistent-model-id',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events).toEqual([
        {
          type: 'error',
          data: {
            code: 'model_unavailable',
            message: expect.any(String),
          },
        },
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

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        modelId: 'm-disabled',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events).toEqual([
        {
          type: 'error',
          data: {
            code: 'model_unavailable',
            message: expect.any(String),
          },
        },
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

      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      const asyncStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'hi' } }],
        } as any;
      })();

      runtime.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        modelId: 'm1',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      const errorEvents = events.filter(
        (e: any) => e.type === 'error',
      );

      expect(errorEvents).toHaveLength(0);
      expect(
        events.some((e: any) => e.data?.delta),
      ).toBe(true);
    });

    it('falls back to sticky/default when no explicit modelId is provided', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm-default',
        actualName: 'gpt-4o',
        isDefault: true,
        enabled: true,
      } as any);

      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      const asyncStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'hi' } }],
        } as any;
      })();

      runtime.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });

      const obs = svc.streamChat('user-1', {
        message: 'hi',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(models.resolveActiveModel).toHaveBeenCalledWith({
        explicitModelId: null,
        userId: 'user-1',
      });

      const errorEvents = events.filter(
        (e: any) => e.type === 'error',
      );

      expect(errorEvents).toHaveLength(0);
    });
  });

  // ─── message validation ────────────────────────────────────────────────

  describe('message validation (FR-014)', () => {
    it('returns error for empty message', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt',
      } as any);

      const obs = svc.streamChat('user-1', {
        message: '',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events[0]).toEqual({
        type: 'error',
        data: {
          code: 'invalid_message',
          message: expect.any(String),
        },
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
          yield {
            choices: [{ delta: { content: c } }],
          } as any;
        }
      })();

      runtime.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });
    };

    it('creates a conversation and streams tokens', async () => {
      setupStream();

      const obs = svc.streamChat('user-1', {
        message: 'Hi there',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(conversations.create).toHaveBeenCalledWith({
        userId: 'user-1',
        modelId: 'm1',
        userMessage: 'Hi there',
      });

      expect(conversations.appendMessage).toHaveBeenCalledWith(
        'conv-1',
        '',
      );

      expect(
        conversations.updateMessageStatus,
      ).toHaveBeenCalledWith(
        expect.any(String),
        'streaming',
      );

      expect(
        conversations.completeIfStreaming,
      ).toHaveBeenCalledWith(
        'msg-1',
        'Hello there!',
        [],
        {
          enabled: false,
          summary: null,
        },
      );

      expect(events[0]).toEqual({
        type: 'start',
        data: {
          conversationId: 'conv-1',
          assistantMessageId: 'msg-1',
        },
      });

      const deltaEvents = events.filter(
        (e) => 'data' in e && !('type' in e),
      );

      expect(
        deltaEvents.map((e: any) => e.data.delta).join(''),
      ).toBe('Hello there!');

      expect(events[events.length - 1]).toEqual({
        type: 'done',
        data: {},
      });

      expect(userRepo.update).toHaveBeenCalledWith(
        { id: 'user-1' },
        { lastSelectedModelId: 'm1' },
      );
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
          {
            role: 'user',
            content: 'Previous question',
          },
          {
            role: 'assistant',
            content: 'Previous answer',
          },
        ],
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });

      const asyncStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'New answer' } }],
        } as any;
      })();

      runtime.stream.mockResolvedValue(asyncStream);

      const obs = svc.streamChat('user-1', {
        message: 'Follow-up',
        conversationId: 'conv-2',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(runtime.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.anything(),
        }),
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: 'Previous question',
            },
            {
              role: 'assistant',
              content: 'Previous answer',
            },
            {
              role: 'user',
              content: 'Follow-up',
            },
          ],
        },
      );

      expect(
        conversations.appendMessage,
      ).toHaveBeenCalledWith('conv-2', '');

      expect(
        conversations.updateMessageStatus,
      ).toHaveBeenCalledWith(
        expect.any(String),
        'streaming',
      );

      expect(
        conversations.completeIfStreaming,
      ).toHaveBeenCalledWith(
        'msg-1',
        'New answer',
        [],
        {
          enabled: false,
          summary: null,
        },
      );

      expect(
        conversations.appendUserMessage,
      ).toHaveBeenCalledWith(
        'conv-2',
        'Follow-up',
        null,
      );
    });
  });

  // ─── file attachment ──────────────────────────────────────────────────

  describe('file attachment', () => {
    const setupStream = () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
        providerId: 'p1',
      } as any);

      conversations.create.mockReturnValue({
        id: 'conv-9',
        messages: [],
      });

      const asyncStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'answer' } }],
        } as any;
      })();

      runtime.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-9',
        status: 'streaming',
      });
    };

    const record = {
      id: 'file-1',
      userId: 'user-1',
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      fileKey: 'k.pdf',
      status: 'READY',
      extractedText: 'PDF TEXT',
    } as any;

    function collect(
      obs: ReturnType<ChatService['streamChat']>,
    ): Promise<any[]> {
      return new Promise((resolve) => {
        const events: any[] = [];

        void obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(events),
        });
      });
    }

    it('augments only the last provider message with the file context', async () => {
      setupStream();

      files.findOwned.mockResolvedValue(record);

      const events = await collect(
        svc.streamChat('user-1', {
          message: 'Summarize this',
          fileId: 'file-1',
        }),
      );

      expect(files.findOwned).toHaveBeenCalledWith(
        'file-1',
        'user-1',
      );

      expect(runtime.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.anything(),
        }),
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content:
                '[Attached file: report.pdf (application/pdf)]\n' +
                'PDF TEXT\n' +
                '[/Attached file]\n\n' +
                'Summarize this',
            },
          ],
        },
      );

      expect(conversations.create).toHaveBeenCalledWith({
        userId: 'user-1',
        modelId: 'm1',
        userMessage: 'Summarize this',
        fileId: 'file-1',
      });

      expect(events[events.length - 1]).toEqual({
        type: 'done',
        data: {},
      });
    });

    it('emits file_not_found and skips the provider when the file is unknown or foreign', async () => {
      setupStream();

      files.findOwned.mockResolvedValue(null);

      const events = await collect(
        svc.streamChat('user-1', {
          message: 'hi',
          fileId: 'nope',
        }),
      );

      expect(events).toEqual([
        {
          type: 'error',
          data: {
            code: 'file_not_found',
            message: expect.any(String),
          },
        },
      ]);

      expect(runtime.stream).not.toHaveBeenCalled();
      expect(conversations.create).not.toHaveBeenCalled();
    });

    it('emits file_processing while the file is still being processed', async () => {
      setupStream();

      files.findOwned.mockResolvedValue({
        ...record,
        status: 'PROCESSING',
      });

      const events = await collect(
        svc.streamChat('user-1', {
          message: 'hi',
          fileId: 'file-1',
        }),
      );

      expect(events).toEqual([
        {
          type: 'error',
          data: {
            code: 'file_processing',
            message: expect.any(String),
          },
        },
      ]);

      expect(runtime.stream).not.toHaveBeenCalled();
      expect(conversations.create).not.toHaveBeenCalled();
    });

    it('emits file_unreadable when file processing failed', async () => {
      setupStream();

      files.findOwned.mockResolvedValue({
        ...record,
        status: 'FAILED',
        errorMessage: 'corrupt pdf',
      });

      const events = await collect(
        svc.streamChat('user-1', {
          message: 'hi',
          fileId: 'file-1',
        }),
      );

      expect(events).toEqual([
        {
          type: 'error',
          data: {
            code: 'file_unreadable',
            message: 'corrupt pdf',
          },
        },
      ]);

      expect(runtime.stream).not.toHaveBeenCalled();
      expect(conversations.create).not.toHaveBeenCalled();
    });

    it('ignores a blank fileId and behaves like a plain message', async () => {
      setupStream();

      await collect(
        svc.streamChat('user-1', {
          message: 'hi',
          fileId: '  ',
        }),
      );

      expect(files.findOwned).not.toHaveBeenCalled();
    });
  });

  // ─── client-disconnect resilience ──────────────────────────────────────

  describe('client disconnect mid-stream', () => {
    function buildSlowStream(chunks: string[], delayMs: number) {
      return (async function* () {
        for (const c of chunks) {
          await new Promise((r) => setTimeout(r, delayMs));

          yield {
            choices: [{ delta: { content: c } }],
          } as any;
        }
      })();
    }

    it('persists the FULL assistant response even when the client unsubscribes mid-stream', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      conversations.findStreamingMessage.mockResolvedValue(null);

      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
      });

      runtime.stream.mockResolvedValue(
        buildSlowStream(
          ['Hello', ' ', 'world'],
          30,
        ),
      );

      const obs = svc.streamChat('user-1', {
        message: 'Hi',
      });

      const events: any[] = [];

      const sub = obs.subscribe({
        next: (e) => events.push(e),
      });

      await new Promise((r) => setTimeout(r, 45));

      expect(
        events.some(
          (e: any) =>
            'data' in e &&
            !('type' in e),
        ),
      ).toBe(true);

      sub.unsubscribe();

      await new Promise((r) => setTimeout(r, 200));

      expect(
        conversations.completeIfStreaming,
      ).toHaveBeenCalledWith(
        'msg-1',
        'Hello world',
        [],
        {
          enabled: false,
          summary: null,
        },
      );
    });

    it('emits no SSE events to the observer after the client has unsubscribed', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-2',
        messages: [],
      });

      conversations.findStreamingMessage.mockResolvedValue(null);

      conversations.create.mockReturnValue({
        id: 'conv-2',
        messages: [],
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-2',
      });

      runtime.stream.mockResolvedValue(
        buildSlowStream(
          ['a', 'b', 'c', 'd'],
          30,
        ),
      );

      const obs = svc.streamChat('user-1', {
        message: 'Hi',
      });

      const events: any[] = [];

      const sub = obs.subscribe({
        next: (e) => events.push(e),
      });

      await new Promise((r) => setTimeout(r, 45));

      const eventsBeforeDisconnect = events.length;

      sub.unsubscribe();

      await new Promise((r) => setTimeout(r, 200));

      expect(events.length).toBe(eventsBeforeDisconnect);

      expect(
        conversations.completeIfStreaming,
      ).toHaveBeenCalledWith(
        'msg-2',
        'abcd',
        [],
        {
          enabled: false,
          summary: null,
        },
      );
    });

    it('persists the partial response if the provider errors mid-stream after the client disconnected', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-3',
        messages: [],
      });

      conversations.findStreamingMessage.mockResolvedValue(null);

      conversations.create.mockReturnValue({
        id: 'conv-3',
        messages: [],
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-3',
      });

      const erroringStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'partial' } }],
        } as any;

        await new Promise((r) => setTimeout(r, 30));

        throw new Error('upstream blew up');
      })();

      runtime.stream.mockResolvedValue(erroringStream);

      const obs = svc.streamChat('user-1', {
        message: 'Hi',
      });

      const sub = obs.subscribe({
        next: () => {},
      });

      await new Promise((r) => setTimeout(r, 15));

      sub.unsubscribe();

      await new Promise((r) => setTimeout(r, 200));

      expect(
        conversations.updateMessageStatus,
      ).toHaveBeenCalledWith(
        'msg-3',
        'failed',
        'partial',
      );
    });
  });

  // ─── streaming status tracking ────────────────────────────────────────

  describe('streaming status tracking', () => {
    it('returns 409 when an active generation already exists', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [],
      });

      conversations.findStreamingMessage.mockResolvedValue({
        id: 'stream-msg',
        status: 'streaming',
      });

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        conversationId: 'conv-1',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events[0]).toEqual({
        type: 'error',
        data: {
          code: 'generation_in_progress',
          message: expect.any(String),
        },
      });
    });

    it('creates assistant message with status=streaming and updates to completed', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [],
      });

      conversations.findStreamingMessage.mockResolvedValue(null);

      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      const asyncStream = (async function* () {
        yield {
          choices: [{ delta: { content: 'hi' } }],
        } as any;
      })();

      runtime.stream.mockResolvedValue(asyncStream);

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        conversationId: 'conv-1',
      });

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: () => {},
          complete: () => resolve(),
        });
      });

      expect(
        conversations.appendMessage,
      ).toHaveBeenCalledWith(
        'conv-1',
        '',
      );

      expect(
        conversations.updateMessageStatus,
      ).toHaveBeenCalledWith(
        'msg-1',
        'streaming',
      );

      expect(
        conversations.completeIfStreaming,
      ).toHaveBeenCalledWith(
        'msg-1',
        'hi',
        [],
        {
          enabled: false,
          summary: null,
        },
      );
    });

    it('updates message status to failed when every provider candidate fails', async () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [],
      });

      conversations.findStreamingMessage.mockResolvedValue(null);

      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });

      runtime.stream.mockRejectedValue(
        new Error('provider down'),
      );

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        conversationId: 'conv-1',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(events[0]).toEqual({
        type: 'start',
        data: {
          conversationId: 'conv-1',
          assistantMessageId: 'msg-1',
        },
      });

      expect(events[1]).toEqual({
        type: 'error',
        data: {
          code: 'provider_error',
          message: expect.any(String),
        },
      });

      expect(
        conversations.updateMessageStatus,
      ).toHaveBeenCalledWith(
        'msg-1',
        'failed',
        '',
      );
    });
  });

  // ─── explicit model entitlement ────────────────────────────────────────

  describe('explicit model entitlement', () => {
    it('never uses an explicit model the caller is not entitled to', async () => {
      models.findById.mockResolvedValue({
        id: 'priv',
        enabled: true,
        visibility: 'private',
      });

      access.canAccessUser.mockResolvedValue(false);

      conversations.create.mockReturnValue({
        id: 'conv-new',
        messages: [],
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-new',
        status: 'streaming',
      });

      const events: any[] = [];

      svc
        .streamChat('user-1', {
          message: 'hi',
          modelId: 'priv',
        })
        .subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 20));

      expect(events).toContainEqual({
        type: 'error',
        data: expect.objectContaining({
          code: 'all_providers_unavailable',
        }),
      });

      expect(
        access.canAccessUser,
      ).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          id: 'priv',
        }),
      );

      expect(runtime.stream).not.toHaveBeenCalled();

      expect(
        conversations.updateMessageStatus,
      ).toHaveBeenCalledWith(
        'msg-new',
        'failed',
        '',
      );
    });

    it('keeps model_unavailable for a disabled model (no entitlement leak)', async () => {
      models.findById.mockResolvedValue({
        id: 'off',
        enabled: false,
        visibility: 'public',
      });

      access.canAccessUser.mockResolvedValue(false);

      const events: any[] = [];

      svc
        .streamChat('user-1', {
          message: 'hi',
          modelId: 'off',
        })
        .subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));

      expect(events).toContainEqual({
        type: 'error',
        data: expect.objectContaining({
          code: 'model_unavailable',
        }),
      });
    });

    it('proceeds for an entitled explicit model', async () => {
      models.findById.mockResolvedValue({
        id: 'pub',
        enabled: true,
        visibility: 'public',
      });

      access.canAccessUser.mockResolvedValue(true);

      conversations.create.mockReturnValue({
        id: 'conv-1',
        messages: [],
      });

      const events: any[] = [];

      svc
        .streamChat('user-1', {
          message: 'hi',
          modelId: 'pub',
        })
        .subscribe((e) => events.push(e));

      await new Promise((r) => setTimeout(r, 0));

      expect(
        events.some(
          (e: any) =>
            e?.type === 'error' &&
            e.data.code === 'model_forbidden',
        ),
      ).toBe(false);
    });
  });

  // ─── cancellation ──────────────────────────────────────────────────────

  describe('cancellation', () => {
    const setupActiveStream = () => {
      models.resolveActiveModel.mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [],
      });

      conversations.findStreamingMessage
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          id: 'msg-1',
          status: 'streaming',
        });

      conversations.cancelGeneration.mockResolvedValue({
        id: 'msg-1',
        status: 'cancelled',
      });

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-1',
        status: 'streaming',
      });

      runtime.stream.mockResolvedValue(
        (async function* () {
          for (const c of ['Hello', ' ', 'world']) {
            yield {
              choices: [{ delta: { content: c } }],
            } as any;

            await new Promise((r) => setTimeout(r, 20));
          }
        })(),
      );
    };

    it('broadcasts generation_cancelled to subscribers when cancelled mid-stream', async () => {
      setupActiveStream();

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        conversationId: 'conv-1',
      });

      const events: any[] = [];

      obs.subscribe({
        next: (e) => events.push(e),
      });

      await new Promise((r) => setTimeout(r, 50));

      expect(
        events.some(
          (e: any) =>
            'data' in e &&
            !('type' in e),
        ),
      ).toBe(true);

      await svc.cancelGeneration(
        'conv-1',
        'user-1',
      );

      const cancelEvents = events.filter(
        (e: any) =>
          e.type === 'error' &&
          e.data?.code === 'generation_cancelled',
      );

      expect(
        cancelEvents.length,
      ).toBeGreaterThanOrEqual(1);
    });

    it('never resurrects a cancelled message to completed', async () => {
      setupActiveStream();

      conversations.completeIfStreaming.mockResolvedValue(false);

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        conversationId: 'conv-1',
      });

      const events: any[] = [];

      obs.subscribe({
        next: (e) => events.push(e),
      });

      await new Promise((r) => setTimeout(r, 50));

      await svc.cancelGeneration(
        'conv-1',
        'user-1',
      );

      await new Promise((r) => setTimeout(r, 150));

      expect(
        conversations.updateMessageStatus,
      ).not.toHaveBeenCalledWith(
        'msg-1',
        'completed',
        expect.anything(),
      );

      expect(
        events.some(
          (e: any) => e.type === 'done',
        ),
      ).toBe(false);
    });

    it('aborts a stream cancelled before it was registered (pre-first-token window)', async () => {
      setupActiveStream();

      conversations.findStreamingMessage
        .mockReset()
        .mockResolvedValueOnce({
          id: 'msg-1',
          status: 'streaming',
        })
        .mockResolvedValue(null);

      await svc.cancelGeneration(
        'conv-1',
        'user-1',
      );

      expect(
        conversations.cancelGeneration,
      ).toHaveBeenCalledWith(
        'conv-1',
        'msg-1',
        'user-1',
      );

      const obs = svc.streamChat('user-1', {
        message: 'hi',
        conversationId: 'conv-1',
      });

      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      expect(
        events.some(
          (e: any) => e.type === 'start',
        ),
      ).toBe(true);

      expect(
        events.some(
          (e: any) =>
            'data' in e &&
            !('type' in e),
        ),
      ).toBe(false);

      expect(
        events.some(
          (e: any) =>
            e.type === 'error' &&
            e.data?.code ===
              'generation_cancelled',
        ),
      ).toBe(true);

      expect(
        conversations.updateMessageStatus,
      ).not.toHaveBeenCalledWith(
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
        id: 'm1',
        actualName: 'gpt-4o',
        enabled: true,
        isDefault: true,
      } as any);

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [
          {
            id: 'u1',
            role: 'user',
            content: 'hi',
            status: 'completed',
          },
          {
            id: 'm-failed',
            role: 'assistant',
            content: '',
            status: 'failed',
          },
        ],
      });

      conversations.findStreamingMessage.mockResolvedValue(null);

      conversations.appendMessage.mockResolvedValue({
        id: 'msg-new',
        status: 'streaming',
      });

      runtime.stream.mockResolvedValue(
        (async function* () {
          yield {
            choices: [{ delta: { content: 'retry' } }],
          } as any;

          yield {
            choices: [{ delta: { content: ' works' } }],
          } as any;
        })(),
      );
    };

    const collect = async (
      obs: ReturnType<
        ChatService['retryGenerationStream']
      >,
    ) => {
      const events: any[] = [];

      await new Promise<void>((resolve) => {
        obs.subscribe({
          next: (e) => events.push(e),
          complete: () => resolve(),
        });
      });

      return events;
    };

    it('starts a REAL generation for the failed message and streams it', async () => {
      setupRetry();

      const events = await collect(
        svc.retryGenerationStream(
          'user-1',
          'conv-1',
          'm-failed',
        ),
      );

      expect(events[0]).toEqual({
        type: 'start',
        data: {
          conversationId: 'conv-1',
          assistantMessageId: 'msg-new',
        },
      });

      const deltas = events.filter(
        (e) => 'data' in e && !('type' in e),
      );

      expect(
        deltas
          .map((e: any) => e.data.delta)
          .join(''),
      ).toBe('retry works');

      expect(events[events.length - 1]).toEqual({
        type: 'done',
        data: {},
      });

      expect(runtime.stream).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.anything(),
        }),
        {
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: 'hi',
            },
          ],
        },
      );

      expect(
        conversations.completeIfStreaming,
      ).toHaveBeenCalledWith(
        'msg-new',
        'retry works',
        [],
        {
          enabled: false,
          summary: null,
        },
      );
    });

    it('rejects retrying a message that is not failed/cancelled', async () => {
      setupRetry();

      conversations.findById.mockReturnValue({
        id: 'conv-1',
        userId: 'user-1',
        messages: [
          {
            id: 'm-ok',
            role: 'assistant',
            content: 'fine',
            status: 'completed',
          },
        ],
      });

      const events = await collect(
        svc.retryGenerationStream(
          'user-1',
          'conv-1',
          'm-ok',
        ),
      );

      expect(events).toEqual([
        {
          type: 'error',
          data: {
            code: 'message_not_retryable',
            message: expect.any(String),
          },
        },
      ]);

      expect(
        runtime.stream,
      ).not.toHaveBeenCalled();

      expect(
        conversations.appendMessage,
      ).not.toHaveBeenCalled();
    });

    it('refuses to retry while another generation is in progress', async () => {
      setupRetry();

      conversations.findStreamingMessage.mockResolvedValue({
        id: 'busy',
        status: 'streaming',
      });

      const events = await collect(
        svc.retryGenerationStream(
          'user-1',
          'conv-1',
          'm-failed',
        ),
      );

      expect(events[0].type).toBe('error');
      expect(
        events[0].data.code,
      ).toBe('generation_in_progress');

      expect(
        conversations.appendMessage,
      ).not.toHaveBeenCalled();
    });
  });
});