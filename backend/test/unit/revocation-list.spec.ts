import {
  _resetForTests,
  gcRevoked,
  isRevoked,
  revokeJti,
} from '../../src/modules/auth/strategies/revocation-list';

describe('revocation-list', () => {
  beforeEach(() => _resetForTests());

  it('reports a freshly-revoked jti as revoked', () => {
    const future = new Date(Date.now() + 60_000);
    revokeJti('jti-1', future);
    expect(isRevoked('jti-1')).toBe(true);
  });

  it('reports an expired revocation as not revoked (and clears it)', () => {
    const past = new Date(Date.now() - 60_000);
    revokeJti('jti-2', past);
    expect(isRevoked('jti-2')).toBe(false);
    expect(isRevoked('jti-2')).toBe(false); // idempotent after GC
    expect(gcRevoked()).toBeGreaterThanOrEqual(0);
  });

  it('reports unknown jtis as not revoked', () => {
    expect(isRevoked('unknown')).toBe(false);
  });
});
