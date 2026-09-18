/**
 * Access-control vocabulary for the model catalog.
 *
 * Kept dependency-free (no Nest, no TypeORM) so entities, DTOs, the policy
 * service and the tests all import the exact same string literals.
 */
export type ModelVisibility = 'public' | 'commercial' | 'private';
export type UserAccessTier = 'free' | 'commercial';

export const MODEL_VISIBILITIES: readonly ModelVisibility[] = ['public', 'commercial', 'private'];
export const USER_ACCESS_TIERS: readonly UserAccessTier[] = ['free', 'commercial'];

/** Ordered ladder for the tier a *viewer* holds. */
export const TIER_RANK: Record<UserAccessTier, number> = { free: 0, commercial: 1 };

/** Ordered ladder for the visibility a *model* requires. */
export const VISIBILITY_RANK: Record<ModelVisibility, number> = {
  public: 0,
  commercial: 1,
  private: 2,
};
