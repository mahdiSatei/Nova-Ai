/**
 * Phase 5 removed token quotas in favour of the credit wallet. This guard keeps
 * the module from being reintroduced by accident.
 */
describe('quotas module removal', () => {
  it('no longer resolves the QuotasModule', () => {
    expect(() => require('../../src/modules/quotas/quotas.module')).toThrow();
  });

  it('no longer resolves the QuotaService', () => {
    expect(() => require('../../src/modules/quotas/quotas.service')).toThrow();
  });
});
