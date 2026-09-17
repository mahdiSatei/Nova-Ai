/**
 * In-memory revocation list for refresh-token `jti`s. Logout writes
 * the jti here until the token's natural expiry. Horizontal scaling
 * is out of MVP scope; if it ever enters, swap this for a Redis-
 * backed implementation behind the same interface.
 */

const revoked = new Map<string, number>(); // jti -> expiresAt epoch ms

/** Revoke a jti until its natural expiry. */
export function revokeJti(jti: string, expiresAt: Date): void {
  revoked.set(jti, expiresAt.getTime());
}

/** True iff the jti is currently revoked (not yet expired). */
export function isRevoked(jti: string, now: number = Date.now()): boolean {
  const exp = revoked.get(jti);
  if (exp === undefined) return false;
  if (exp <= now) {
    revoked.delete(jti);
    return false;
  }
  return true;
}

/** Drop expired entries opportunistically. Called once per request. */
export function gcRevoked(now: number = Date.now()): number {
  let removed = 0;
  for (const [jti, exp] of revoked.entries()) {
    if (exp <= now) {
      revoked.delete(jti);
      removed++;
    }
  }
  return removed;
}

/** Test-only: clear the entire list. */
export function _resetForTests(): void {
  revoked.clear();
}
