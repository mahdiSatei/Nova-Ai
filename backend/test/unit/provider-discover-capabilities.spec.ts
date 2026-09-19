import { OpenAICompatibleAdapter } from '../../src/modules/provider/adapters/openai-compatible.adapter';

jest.mock('../../src/common/crypto/credential-cipher', () => ({
  decrypt: () => 'sk_test',
  encrypt: (v: string) => v,
}));

const PROVIDER = {
  id: 'p1',
  type: 'openai-compatible',
  baseUrl: 'https://openrouter.ai/api/v1',
  apiKeyEncrypted: 'x',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('OpenAICompatibleAdapter.discoverCapabilities', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reads explicit supported_parameters from provider metadata', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [
          { id: 'other-model', supported_parameters: ['tools'] },
          { id: 'some/model', supported_parameters: ['tools', 'reasoning'] },
        ],
      }),
    );

    const signals = await new OpenAICompatibleAdapter().discoverCapabilities(
      PROVIDER as never,
      'some/model',
    );

    expect(signals).toEqual({
      reportsReasoning: true,
      reportsReasoningSummary: true,
      reportsReasoningStreaming: true,
    });
  });

  it('reports no reasoning when the provider enumerates parameters without one', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: 'some/model', supported_parameters: ['tools', 'temperature'] }],
      }),
    );

    const signals = await new OpenAICompatibleAdapter().discoverCapabilities(
      PROVIDER as never,
      'some/model',
    );
    expect(signals).toEqual({ reportsReasoning: false });
  });

  it('stays unknown when the provider exposes no capability metadata', async () => {
    // OpenAI-style /models: no capability fields at all.
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        data: [{ id: 'reasoning-model-9000', object: 'model', created: 1, owned_by: 'x' }],
      }),
    );

    const signals = await new OpenAICompatibleAdapter().discoverCapabilities(
      PROVIDER as never,
      'reasoning-model-9000',
    );
    expect(signals).toBeNull();
  });

  it('stays unknown for an unknown model id', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { data: [{ id: 'other', supported_parameters: ['reasoning'] }] }),
    );

    const signals = await new OpenAICompatibleAdapter().discoverCapabilities(PROVIDER as never, 'missing');
    expect(signals).toBeNull();
  });

  it('stays unknown when metadata cannot be read', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNRESET'));
    const signals = await new OpenAICompatibleAdapter().discoverCapabilities(
      PROVIDER as never,
      'some/model',
    );
    expect(signals).toBeNull();

    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}));
    expect(
      await new OpenAICompatibleAdapter().discoverCapabilities(PROVIDER as never, 'some/model'),
    ).toBeNull();
  });

  it('never issues a generation request', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, { data: [] }));

    await new OpenAICompatibleAdapter().discoverCapabilities(PROVIDER as never, 'some/model');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(init.method ?? 'GET').toBe('GET');
  });
});
