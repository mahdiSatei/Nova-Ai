import { OpenAICompatibleAdapter } from '../../src/modules/provider/adapters/openai-compatible.adapter';
import { Provider } from '../../src/modules/provider/entities/provider.entity';

jest.mock('../../src/common/crypto/credential-cipher', () => ({
  decrypt: () => 'fake-test-credential',
}));

const makeProvider = (overrides: Partial<Provider> = {}): Provider => ({
  id: 'test-provider',
  type: 'openai-compatible',
  baseUrl: 'https://provider.example/v1',
  name: 'Test',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastValidatedAt: null,
  apiKeyEncrypted: 'test-ciphertext',
  ...overrides,
} as Provider);

describe('OpenAICompatibleAdapter.validate status mapping', () => {
  const adapter = new OpenAICompatibleAdapter();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps 401 to 422 credentials_rejected', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(adapter.validate(makeProvider())).rejects.toMatchObject({
      code: 'credentials_rejected',
      statusCode: 422,
    });
  });

  it('maps 403 to 422 credentials_rejected', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('forbidden', { status: 403 }));
    await expect(adapter.validate(makeProvider())).rejects.toMatchObject({
      code: 'credentials_rejected',
      statusCode: 422,
    });
  });

  it('maps 404 to 422 provider_type_unsupported without fallback', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    await expect(adapter.validate(makeProvider())).rejects.toMatchObject({
      code: 'provider_type_unsupported',
      statusCode: 422,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('maps 405 to 422 provider_type_unsupported without fallback', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('method not allowed', { status: 405 }));
    await expect(adapter.validate(makeProvider())).rejects.toMatchObject({
      code: 'provider_type_unsupported',
      statusCode: 422,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('maps 503 to 503 provider_rate_limited', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('rate limited', { status: 503 }));
    await expect(adapter.validate(makeProvider())).rejects.toMatchObject({
      code: 'provider_rate_limited',
      statusCode: 503,
    });
  });

  it('maps 500 to 502 provider_unreachable', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('server error', { status: 500 }));
    await expect(adapter.validate(makeProvider())).rejects.toMatchObject({
      code: 'provider_unreachable',
      statusCode: 502,
    });
  });
});
