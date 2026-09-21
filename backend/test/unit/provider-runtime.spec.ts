import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProviderRuntimeService } from '../../src/modules/provider/provider-runtime.service';
import { PROVIDER_ADAPTERS, ProviderService } from '../../src/modules/provider/provider.service';
import { ModelsService } from '../../src/modules/models/models.service';
import { ProviderAdapter } from '../../src/modules/provider/adapters/provider-adapter.interface';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { Model } from '../../src/modules/models/entities/model.entity';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

describe('ProviderRuntimeService.assertReady', () => {
  let service: ProviderRuntimeService;
  let models: jest.Mocked<ModelsService>;
  let adapter: any;

  beforeEach(async () => {
    adapter = {
      supports: jest.fn().mockReturnValue(true),
      validate: jest.fn(),
      stream: jest.fn(),
    };

    models = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<ModelsService>;

    const mockProviderService = {
      getRandomActiveApiKey: jest.fn().mockResolvedValue('sk-test-key'),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProviderRuntimeService,
        { provide: ModelsService, useValue: models },
        { provide: getRepositoryToken(Provider), useValue: { findOne: jest.fn() } as unknown as Repository<Provider> },
        { provide: PROVIDER_ADAPTERS, useValue: [adapter] },
        { provide: ProviderService, useValue: mockProviderService },
      ],
    }).compile();

    service = module.get(ProviderRuntimeService);
  });

  it('throws when no adapter matches provider type', async () => {
    adapter.supports.mockReturnValue(false);
    models.findById.mockResolvedValue({ id: 'm1', providerId: 'p1' } as Model);
    service['providerRepo'].findOne = jest.fn().mockResolvedValue({ id: 'p1', type: 'unknown' as any, isActive: true, name: '', baseUrl: '', apiKeyEncrypted: '', createdAt: new Date(), updatedAt: new Date(), lastValidatedAt: null } as any);

    await expect(service.assertReady('m1')).rejects.toMatchObject({ response: { code: 'provider_type_unsupported' } });
  });

  it('returns connection for active provider', async () => {
    const provider = { id: 'p1', type: 'openai-compatible', isActive: true } as Provider;
    models.findById.mockResolvedValue({ id: 'm1', providerId: 'p1' } as Model);
    service['providerRepo'].findOne = jest.fn().mockResolvedValue(provider);

    const connection = await service.assertReady('m1');

    expect(connection.provider).toBe(provider);
    expect(connection.adapter).toBe(adapter);
  });

  it('throws when provider missing', async () => {
    models.findById.mockResolvedValue({ id: 'm1', providerId: 'missing' } as Model);
    service['providerRepo'].findOne = jest.fn().mockResolvedValue(null);

    await expect(service.assertReady('m1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws when provider inactive', async () => {
    models.findById.mockResolvedValue({ id: 'm1', providerId: 'p1' } as Model);
    service['providerRepo'].findOne = jest.fn().mockResolvedValue({ id: 'p1', isActive: false } as Provider);

    await expect(service.assertReady('m1')).rejects.toMatchObject({ response: { code: 'provider_inactive' } });
  });
});
