import { ModelsService } from '../../src/modules/models/models.service';

const code = (fn: () => Promise<unknown>) =>
  fn().catch((e) => (e as { response?: { code?: string } }).response?.code);

interface Fixtures {
  fallback?: Record<string, unknown> | null;
  providerActive?: boolean;
}

function build(fixtures: Fixtures = {}) {
  const saved: Record<string, unknown>[] = [];
  const isDefault = { default_model_id: null as string | null };

  const qb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(async () => ({ is_active: fixtures.providerActive ?? true })),
  };

  const repo = {
    // findById('m1') then the fallback lookup by id.
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id === 'm1') {
        return {
          id: 'm1',
          displayName: 'primary',
          actualName: 'gpt-4o-mini',
          providerId: 'p1',
          visibility: 'public',
          enabled: true,
          isDefault: false,
          fallbackModelId: null,
        };
      }
      if (where.id === 'm2') {
        // `'fallback' in fixtures` distinguishes "explicitly null" (unknown
        // model) from "unset" (use the default enabled model).
        if ('fallback' in fixtures) return fixtures.fallback ?? null;
        return { id: 'm2', providerId: 'p1', enabled: true, visibility: 'public' };
      }
      return null;
    }),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(null), // no displayName duplicate
      getRawOne: jest.fn(async () => isDefault),
    })),
    manager: { createQueryBuilder: jest.fn(() => qb) },
    create: jest.fn((x: Record<string, unknown>) => x),
    save: jest.fn(async (m: Record<string, unknown>) => {
      saved.push(m);
      return m;
    }),
  };

  const service = new ModelsService(repo as never, {} as never, {
    discover: jest.fn(),
  } as never);
  return { service, repo, saved };
}

describe('ModelsService fallback configuration (spec 006)', () => {
  it('rejects a model that is its own fallback', async () => {
    const { service } = build();
    expect(await code(() => service.update('m1', { fallbackModelId: 'm1' }))).toBe(
      'invalid_fallback_model',
    );
  });

  it('rejects an unknown fallback model', async () => {
    const { service } = build({ fallback: null });
    expect(await code(() => service.update('m1', { fallbackModelId: 'm2' }))).toBe(
      'invalid_fallback_model',
    );
  });

  it('rejects a disabled fallback model', async () => {
    const { service } = build({ fallback: { id: 'm2', providerId: 'p1', enabled: false } });
    expect(await code(() => service.update('m1', { fallbackModelId: 'm2' }))).toBe(
      'invalid_fallback_model',
    );
  });

  it('rejects a fallback whose provider is inactive', async () => {
    const { service } = build({ providerActive: false });
    expect(await code(() => service.update('m1', { fallbackModelId: 'm2' }))).toBe(
      'invalid_fallback_model',
    );
  });

  it('accepts an enabled model on an active provider', async () => {
    const { service, saved } = build();
    await service.update('m1', { fallbackModelId: 'm2' });
    expect(saved.at(-1)).toMatchObject({ id: 'm1', fallbackModelId: 'm2' });
  });

  it('clears the fallback when null is passed', async () => {
    const { service, saved } = build();
    await service.update('m1', { fallbackModelId: null });
    expect(saved.at(-1)).toMatchObject({ fallbackModelId: null });
  });

  it('leaves the fallback untouched when the field is absent', async () => {
    const { service, saved } = build();
    await service.update('m1', { displayName: 'renamed' });
    expect(saved.at(-1)).toMatchObject({ displayName: 'renamed', fallbackModelId: null });
  });

  it('validates the fallback on create', async () => {
    const { service } = build({ fallback: null });
    expect(
      await code(() =>
        service.create({
          displayName: 'new',
          actualName: 'a',
          providerId: 'p1',
          fallbackModelId: 'missing',
        }),
      ),
    ).toBe('invalid_fallback_model');
  });
});
