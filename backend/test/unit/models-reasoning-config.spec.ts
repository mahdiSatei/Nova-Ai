import { ModelsService } from '../../src/modules/models/models.service';

const code = (fn: () => Promise<unknown>) =>
  fn().catch(
    (e) => (e as { response?: { code?: string } }).response?.code ?? (e as { code?: string }).code,
  );

function build(
  discovery: { capability: Record<string, unknown>; sources: Record<string, string> } = {
    capability: { supported: true, output: 'summary', streaming: true },
    sources: { supported: 'provider_api', output: 'provider_rules', streaming: 'provider_rules' },
  },
) {
  const saved: Record<string, any>[] = [];
  const existing = {
    id: 'm1',
    displayName: 'Model',
    actualName: 'some/model',
    providerId: 'p1',
    visibility: 'public',
    enabled: true,
    isDefault: false,
    fallbackModelId: null,
    reasoningConfig: {},
  };

  const qb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(async () => ({ is_active: true })),
  };

  const repo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === 'm1' ? { ...existing } : null,
    ),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null),
      getRawOne: jest.fn(async () => ({ is_active: true })),
    })),
    manager: { createQueryBuilder: jest.fn(() => qb) },
    create: jest.fn((value: Record<string, unknown>) => value),
    save: jest.fn(async (value: Record<string, unknown>) => {
      saved.push(value);
      return value;
    }),
  };

  const reasoningCapability = {
    discover: jest.fn().mockResolvedValue({
      capability: discovery.capability,
      sources: discovery.sources,
      discoveredAt: '2026-09-19T00:00:00.000Z',
    }),
  };

  const service = new ModelsService(repo as never, {} as never, reasoningCapability as never);
  return { service, repo, saved, reasoningCapability };
}

describe('ModelsService reasoning configuration', () => {
  it('discovers capabilities when creating a model', async () => {
    const { service, repo, reasoningCapability } = build();

    const created = await service.create({
      displayName: 'Reasoner',
      actualName: 'some/model',
      providerId: 'p1',
    });

    expect(reasoningCapability.discover).toHaveBeenCalledWith({
      providerId: 'p1',
      modelName: 'some/model',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningConfig: expect.objectContaining({
          mode: 'automatic',
          discovered: expect.objectContaining({
            supported: true,
            output: 'summary',
            streaming: true,
            sources: expect.objectContaining({ supported: 'provider_api' }),
            discoveredAt: '2026-09-19T00:00:00.000Z',
          }),
          manual: { supported: null, output: null, streaming: null },
        }),
      }),
    );
    expect(created).toBeDefined();
  });

  it('stores manual values and still records what discovery found', async () => {
    const { service, repo, reasoningCapability } = build();

    await service.create({
      displayName: 'Manual',
      actualName: 'some/model',
      providerId: 'p1',
      reasoning: { mode: 'manual', supported: true, output: 'summary', streaming: false },
    });

    expect(reasoningCapability.discover).toHaveBeenCalledWith({
      providerId: 'p1',
      modelName: 'some/model',
    });
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningConfig: expect.objectContaining({
          // The admin's choice is what the application runs on; the discovery
          // snapshot is still recorded so the admin can compare the two.
          mode: 'manual',
          manual: { supported: true, output: 'summary', streaming: false },
          discovered: expect.objectContaining({ supported: true, output: 'summary', streaming: true }),
        }),
      }),
    );
  });

  it('rejects a contradictory manual configuration', async () => {
    const { service } = build();
    expect(
      await code(() =>
        service.update('m1', {
          reasoning: { mode: 'manual', supported: false, output: 'summary' },
        }),
      ),
    ).toBe('invalid_reasoning_configuration');
  });

  it('re-discovers when the provider-side model name changes', async () => {
    const { service, reasoningCapability } = build();
    await service.update('m1', { actualName: 'other/model' });
    expect(reasoningCapability.discover).toHaveBeenCalledWith({
      providerId: 'p1',
      modelName: 'other/model',
    });
  });

  it('keeps the stored discovery snapshot when nothing identity-related changed', async () => {
    const { service, reasoningCapability } = build();
    await service.update('m1', { displayName: 'Renamed' });
    expect(reasoningCapability.discover).not.toHaveBeenCalled();
  });

  it('re-discovers on demand', async () => {
    const { service, reasoningCapability, saved } = build();
    await service.rediscoverReasoning('m1');
    expect(reasoningCapability.discover).toHaveBeenCalledTimes(1);
    expect(saved[0].reasoningConfig.discovered.supported).toBe(true);
  });
});
