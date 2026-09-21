/**
 * Access-control vocabulary for the model catalog.
 *
 * Kept dependency-free (no Nest, no TypeORM) so entities, DTOs, the policy
 * service and the tests all import the exact same string literals.
 *
 * Phase 5 retired the `commercial` visibility and the per-user access tier:
 * entitlement is now decided by the prepaid credit wallet, not by a tier
 * ladder. What remains is `public` (any authenticated user) and `private`
 * (admins only).
 */
export type ModelVisibility = 'public' | 'private';

export const MODEL_VISIBILITIES: readonly ModelVisibility[] = ['public', 'private'];
