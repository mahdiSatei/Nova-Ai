import { ProviderAdminController } from '../../src/modules/provider/provider.admin.controller';
import { ProviderAttemptMetrics } from '../../src/modules/provider/provider-attempt-metrics.service';

describe('ProviderAdminController', () => {
  it('returns the current counters', () => {
    const metrics = new ProviderAttemptMetrics();
    metrics.recordAttempt();
    metrics.recordAttempt();
    metrics.recordSuccess();
    metrics.recordFailure('provider_timeout');
    metrics.recordFallback();

    const controller = new ProviderAdminController(metrics);
    expect(controller.metrics()).toEqual({
      attempts: 2,
      successes: 1,
      failures: 1,
      fallbacks: 1,
      failuresByCode: { provider_timeout: 1 },
    });
  });

  it('starts at zero', () => {
    const controller = new ProviderAdminController(new ProviderAttemptMetrics());
    expect(controller.metrics()).toEqual({
      attempts: 0,
      successes: 0,
      failures: 0,
      fallbacks: 0,
      failuresByCode: {},
    });
  });
});
