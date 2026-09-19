import { Test } from '@nestjs/testing';
import { ModelsPublicController } from '../../src/modules/models/models.public.controller';
import { ModelsService } from '../../src/modules/models/models.service';

describe('ModelsPublicController', () => {
  let controller: ModelsPublicController;
  let modelsService: {
    listAccessibleFor: jest.Mock;
  };

  beforeEach(async () => {
    modelsService = {
      listAccessibleFor: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [ModelsPublicController],
      providers: [
        {
          provide: ModelsService,
          useValue: modelsService,
        },
      ],
    }).compile();

    controller = moduleRef.get(ModelsPublicController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('list', () => {
    it('returns enabled models with only public fields', async () => {
      const models = [
        {
          id: 'm1',
          displayName: 'GPT-4o',
          actualName: 'gpt-4o',
          enabled: true,
          isDefault: true,
          // Phase 8: an explicit reasoning capability reported by the provider.
          reasoningConfig: {
            mode: 'automatic',
            discovered: {
              supported: true,
              output: 'summary',
              streaming: true,
              sources: {
                supported: 'provider_api',
                output: 'provider_rules',
                streaming: 'provider_rules',
              },
              discoveredAt: '2026-09-19T00:00:00.000Z',
            },
            manual: { supported: null, output: null, streaming: null },
          },
        },
        { id: 'm2', displayName: 'GPT-4o mini', actualName: 'gpt-4o-mini', enabled: true, isDefault: false },
      ];
      modelsService.listAccessibleFor.mockResolvedValue(models);

      const user = { id: 'u-1', email: 'a@b.com', role: 'user' as const, jti: 'jti-1' };
      const result = await controller.list(user as any);

      expect(modelsService.listAccessibleFor).toHaveBeenCalledWith('u-1');
      expect(result).toEqual({
        items: [
          {
            id: 'm1',
            displayName: 'GPT-4o',
            isDefault: true,
            reasoning: { supported: true, output: 'summary', streaming: true },
          },
          {
            id: 'm2',
            displayName: 'GPT-4o mini',
            isDefault: false,
            // Unknown capability narrows to "unsupported with no output".
            reasoning: { supported: false, output: 'none', streaming: false },
          },
        ],
      });
    });

    it('returns empty items when no models are enabled', async () => {
      modelsService.listAccessibleFor.mockResolvedValue([]);

      const user = { id: 'u-1', email: 'a@b.com', role: 'user' as const, jti: 'jti-1' };
      const result = await controller.list(user as any);

      expect(result).toEqual({ items: [] });
    });

    it('never exposes actualName in the response', async () => {
      const models = [
        { id: 'm1', displayName: 'GPT-4o', actualName: 'gpt-4o', enabled: true, isDefault: false },
      ];
      modelsService.listAccessibleFor.mockResolvedValue(models);

      const user = { id: 'u-1', email: 'a@b.com', role: 'user' as const, jti: 'jti-1' };
      const result = await controller.list(user as any);

      expect((result.items[0] as any).actualName).toBeUndefined();
      // Ensure raw model object isn't leaked
      expect(JSON.stringify(result)).not.toContain('gpt-4o');
    });

    it('filters the catalog by the caller (never returns another user’s models)', async () => {
      modelsService.listAccessibleFor.mockResolvedValue([]);

      const user = { id: 'u-restricted', email: 'r@b.com', role: 'user' as const, jti: 'jti-2' };
      const result = await controller.list(user as any);

      expect(modelsService.listAccessibleFor).toHaveBeenCalledWith('u-restricted');
      expect(result).toEqual({ items: [] });
    });
  });
});
