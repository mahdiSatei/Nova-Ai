import 'reflect-metadata';
import configuration from '../../src/config/configuration';
import { validateEnv } from '../../src/config/env.validation';

describe('Web search configuration', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('defaults the Serpex base URL and leaves the key empty when unset', () => {
    delete process.env.SERPEX_API_KEY;
    delete process.env.SERPEX_API_URL;
    const cfg = configuration();
    expect(cfg.webSearch.serpexApiKey).toBe('');
    expect(cfg.webSearch.serpexApiUrl).toBe('https://api.serpex.dev');
  });

  it('reads SERPEX_API_KEY and SERPEX_API_URL from the environment', () => {
    process.env.SERPEX_API_KEY = 'sk_test_123';
    process.env.SERPEX_API_URL = 'https://api.example.dev';
    const cfg = configuration();
    expect(cfg.webSearch.serpexApiKey).toBe('sk_test_123');
    expect(cfg.webSearch.serpexApiUrl).toBe('https://api.example.dev');
  });

  it('keeps SERPEX_API_KEY optional during env validation', () => {
    const validated = validateEnv({ JWT_SECRET: 'a', JWT_REFRESH_SECRET: 'b' } as never);
    expect(validated).toBeDefined();
  });
});
