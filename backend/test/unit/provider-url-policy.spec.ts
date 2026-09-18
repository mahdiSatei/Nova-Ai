import { validateProviderUrl } from '../../src/modules/provider/utils/url-policy';

describe('validateProviderUrl', () => {
  it('allows http localhost in development', () => {
    const result = validateProviderUrl('http://localhost:1234/v1', 'development');
    expect(result.ok).toBe(true);
  });

  it('allows https localhost in production', () => {
    const result = validateProviderUrl('https://localhost:1234/v1', 'production');
    expect(result.ok).toBe(true);
  });

  it('rejects http in production', () => {
    const result = validateProviderUrl('http://example.com/v1', 'production');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('HTTPS');
  });

  it('rejects private IPs in production', () => {
    const result = validateProviderUrl('https://10.0.0.1:1234/v1', 'production');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Private');
  });

  it('rejects invalid URL', () => {
    const result = validateProviderUrl('not a url', 'development');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Invalid URL');
  });

  it('allows public https in production', () => {
    const result = validateProviderUrl('https://api.example.com/v1', 'production');
    expect(result.ok).toBe(true);
  });
});
