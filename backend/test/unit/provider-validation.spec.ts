import { Repository } from 'typeorm';
import { Provider } from '../../src/modules/provider/entities/provider.entity';
import { ProviderService } from '../../src/modules/provider/provider.service';
import { OpenAICompatibleAdapter } from '../../src/modules/provider/adapters/openai-compatible.adapter';

jest.mock('../../src/common/crypto/credential-cipher', () => ({
  decrypt: () => 'fake-test-credential',
}));

describe('provider validation deadline', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('aborts GET /models after five seconds and returns a normalized 504', async () => {
    jest.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    jest.spyOn(global, 'fetch').mockImplementation((_url, options) => {
      requestSignal = options?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new Error('private upstream detail')), { once: true });
      });
    });
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'test-provider', type: 'openai-compatible',
        baseUrl: 'https://provider.example/v1', apiKeyEncrypted: 'test-ciphertext',
      }),
      save: jest.fn(),
    };
    const apiKeyRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };
    const service = new ProviderService(
      repo as unknown as Repository<Provider>,
      apiKeyRepo as any,
      [new OpenAICompatibleAdapter()],
      { get: () => 'development' } as any,
    );
    const outcome = service.validateProvider('test-provider').catch((error: unknown) => error);

    await jest.advanceTimersByTimeAsync(5000);
    expect(requestSignal?.aborted).toBe(true);
    const error = await outcome;
    expect(error).toMatchObject({
      status: 504,
      response: { code: 'provider_timeout', message: 'Provider validation timed out.' },
    });
    expect(repo.save).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });
});
