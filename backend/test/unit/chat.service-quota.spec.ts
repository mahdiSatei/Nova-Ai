import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChatService } from '../../src/modules/chat/chat.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ModelAccessService } from '../../src/modules/models/model-access.service';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import {
  ProviderFailoverService,
  AllProvidersUnavailableError,
} from '../../src/modules/provider/provider-failover.service';
import { ConversationsService } from '../../src/modules/conversations/conversations.service';
import { UsageService } from '../../src/modules/usage/usage.service';
import { QuotaService } from '../../src/modules/quotas/quotas.service';
import { User } from '../../src/modules/users/entities/user.entity';

/**
 * Quota preflight behaviour: a request that cannot be reserved must be
 * rejected before the provider is invoked.
 */
describe('ChatService quota preflight', () => {
  let svc: ChatService;
  let models: any;
  let runtime: any;
  let conversations: any;
  let quotas: any;

  beforeEach(async () => {
    models = {
      findById: jest.fn(),
      resolveActiveModel: jest.fn().mockResolvedValue({
        id: 'm1',
        actualName: 'gpt-test',
        providerId: 'p1',
        enabled: true,
        inputPricePer1k: 0,
        outputPricePer1k: 0,
      }),
    };
    runtime = {
      assertReady: jest.fn().mockResolvedValue({ provider: { id: 'p1' }, adapter: {} }),
      stream: jest.fn(),
    };
    // Phase 6: establishment goes through the failover service, so this stub
    // delegates to the runtime mocks to keep each test's stream setup intact.
    const failover = {
      establish: jest.fn(async (input: { model: any; messages: any[] }) => {
        try {
          const connection = await runtime.assertReady(input.model.id);
          const stream = await runtime.stream(connection, {
            model: input.model.actualName,
            messages: input.messages,
          });
          return { model: input.model, connection, stream, attempts: 1, failures: [] };
        } catch {
          throw new AllProvidersUnavailableError(
            [
              {
                modelId: input.model.id,
                providerId: input.model.providerId ?? 'p1',
                attempt: 1,
                code: 'provider_error',
                category: 'terminal',
                durationMs: 0,
              },
            ],
            1,
          );
        }
      }),
    };
    conversations = {
      findById: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'c1' }),
      appendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
      findStreamingMessage: jest.fn().mockResolvedValue(null),
      updateMessageStatus: jest.fn().mockResolvedValue({}),
    };
    quotas = {
      checkAndReserve: jest.fn(),
      finalize: jest.fn().mockResolvedValue(undefined),
      refund: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: ModelsService, useValue: models },
        { provide: ModelAccessService, useValue: { canAccessUser: jest.fn().mockResolvedValue(true) } },
        { provide: ProviderRuntimeService, useValue: runtime },
        { provide: ProviderFailoverService, useValue: failover },
        { provide: ConversationsService, useValue: conversations },
        { provide: getRepositoryToken(User), useValue: { update: jest.fn().mockResolvedValue({}) } },
        {
          provide: UsageService,
          useValue: {
            create: jest.fn().mockResolvedValue({ id: 'u1' }),
            finalize: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: QuotaService, useValue: quotas },
      ],
    }).compile();

    svc = moduleRef.get(ChatService);
  });

  const collect = (dto: any) =>
    new Promise<any[]>((resolve) => {
      const events: any[] = [];
      svc.streamChat('user-1', dto).subscribe({
        next: (e) => events.push(e),
        complete: () => resolve(events),
      });
    });

  it('rejects with quota_exceeded before contacting the provider', async () => {
    quotas.checkAndReserve.mockResolvedValue({
      reserved: false,
      quotaId: 'q1',
      tokenRemaining: 12,
      reason: 'quota_exceeded',
    });

    const events = await collect({ message: 'hello there' } as any);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe('error');
    expect(events[0].data.code).toBe('quota_exceeded');
    expect(events[0].data.message).toContain('12');
    // Provider must never be called
    expect(runtime.assertReady).not.toHaveBeenCalled();
    expect(runtime.stream).not.toHaveBeenCalled();
  });

  it('proceeds to the provider when quota is reserved', async () => {
    quotas.checkAndReserve.mockResolvedValue({
      reserved: true,
      quotaId: 'q1',
      newTokenUsed: 3,
      tokenRemaining: 99997,
    });
    runtime.assertReady.mockResolvedValue({
      provider: { id: 'p1' },
      adapter: { stream: jest.fn() },
    });
    runtime.stream.mockResolvedValue(
      (async function* () {
        yield { choices: [{ delta: { content: 'hi' } }] };
        yield { choices: [], usage: { total_tokens: 7 } };
      })(),
    );

    const events = await collect({ message: 'hello there' } as any);

    expect(runtime.assertReady).toHaveBeenCalledWith('m1');
    expect(events.some((e) => e.event === 'done')).toBe(true);
    expect(quotas.finalize).toHaveBeenCalled();
  });

  it('refunds the reservation when the provider stream fails', async () => {
    quotas.checkAndReserve.mockResolvedValue({
      reserved: true,
      quotaId: 'q1',
      newTokenUsed: 3,
      tokenRemaining: 99997,
    });
    runtime.assertReady.mockResolvedValue({
      provider: { id: 'p1' },
      adapter: { stream: jest.fn() },
    });
    runtime.stream.mockRejectedValue(new Error('upstream down'));

    const events = await collect({ message: 'hello there' } as any);

    expect(events.some((e) => e.event === 'error')).toBe(true);
    expect(quotas.refund).toHaveBeenCalledWith('q1', expect.any(Number));
  });
});
