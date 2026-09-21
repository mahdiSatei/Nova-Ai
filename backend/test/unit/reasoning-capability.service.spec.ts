import { ReasoningCapabilityService } from '../../src/modules/models/reasoning-capability.service';

function build(
  fixtures: {
    provider?: Record<string, unknown> | null;
    signals?: unknown;
  } = {},
) {
  const providerRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue(
        fixtures.provider === undefined
          ? {
              id: 'p1',
              type: 'openai-compatible',
              baseUrl: 'https://openrouter.ai/api/v1',
              isActive: true,
            }
          : fixtures.provider,
      ),
  };
  const adapter = {
    supports: () => true,
    discoverCapabilities: jest.fn().mockResolvedValue(fixtures.signals ?? null),
  };
  const service = new ReasoningCapabilityService(providerRepo as never, [adapter] as never);
  return { service, providerRepo, adapter };
}

describe('ReasoningCapabilityService', () => {
  it('maps explicit provider metadata onto the capability triple', async () => {
    const { service } = build({
      signals: {
        reportsReasoning: true,
        reportsReasoningSummary: true,
        reportsReasoningStreaming: false,
      },
    });

    const result = await service.discover({ providerId: 'p1', modelName: 'some/model' });

    expect(result.capability).toEqual({ supported: true, output: 'summary', streaming: false });
    expect(result.sources).toEqual({
      supported: 'provider_api',
      output: 'provider_rules',
      streaming: 'provider_rules',
    });
    expect(Date.parse(result.discoveredAt)).not.toBeNaN();
  });

  it('leaves everything unknown when the provider reports nothing (never names)', async () => {
    const { service } = build({ signals: null });
    const result = await service.discover({ providerId: 'p1', modelName: 'reasoning-model-9000' });
    expect(result.capability).toEqual({ supported: null, output: null, streaming: null });
    expect(result.sources.supported).toBe('unknown');
  });

  it('leaves everything unknown when the provider row is missing or inactive', async () => {
    for (const provider of [
      null,
      { id: 'p1', type: 'openai-compatible', baseUrl: 'https://x', isActive: false },
    ]) {
      const { service, adapter } = build({ provider });
      const result = await service.discover({ providerId: 'p1', modelName: 'm' });
      expect(result.capability.supported).toBeNull();
      expect(adapter.discoverCapabilities).not.toHaveBeenCalled();
    }
  });

  it('leaves everything unknown when the adapter read throws', async () => {
    const { service, adapter } = build();
    adapter.discoverCapabilities.mockRejectedValue(new Error('boom'));
    const result = await service.discover({ providerId: 'p1', modelName: 'm' });
    expect(result.capability.supported).toBeNull();
  });
});
