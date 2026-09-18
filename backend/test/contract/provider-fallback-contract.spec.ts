import { readFileSync } from 'fs';
import { join } from 'path';

const CONTRACT = readFileSync(
  join(__dirname, '../../specs/001-multi-model-chatbot-mvp/contracts/openapi-3.1.yaml'),
  'utf8',
);

describe('provider-fallback contract (spec 006)', () => {
  it('exposes fallbackModelId on the admin model shape', () => {
    const admin = CONTRACT.slice(CONTRACT.indexOf('ModelAdmin:'));
    expect(admin.slice(0, 2000)).toContain('fallbackModelId');
  });

  it('accepts fallbackModelId on the model upsert request', () => {
    const upsert = CONTRACT.slice(CONTRACT.indexOf('ModelUpsertRequest:'));
    expect(upsert.slice(0, 1200)).toContain('fallbackModelId');
  });

  it('records attempts on a usage record', () => {
    const usage = CONTRACT.slice(CONTRACT.indexOf('UsageRecord:'));
    expect(usage.slice(0, 1200)).toContain('attempts');
  });

  it('documents the provider metrics endpoint and its schema', () => {
    expect(CONTRACT).toContain('/v1/admin/provider-metrics:');
    expect(CONTRACT).toContain('ProviderMetrics:');
    expect(CONTRACT).toContain('failuresByCode');
  });

  it('documents the retrying status event and the all-providers error code', () => {
    expect(CONTRACT).toContain('all_providers_unavailable');
    expect(CONTRACT).toContain('"phase":"retrying"');
  });
});
