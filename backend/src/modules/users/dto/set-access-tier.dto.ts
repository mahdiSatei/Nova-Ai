import { IsIn } from 'class-validator';
import { USER_ACCESS_TIERS, UserAccessTier } from '../../models/model-visibility';

/**
 * Body of PATCH /v1/admin/users/:id/access-tier.
 *
 * `free` is the floor every account starts at; `commercial` unlocks models
 * whose visibility is `commercial`. `IsIn` (not IsEnum) keeps the vocabulary in
 * one place — `models/model-visibility.ts`.
 */
export class SetUserAccessTierDto {
  @IsIn(USER_ACCESS_TIERS as unknown as string[], {
    message: 'accessTier must be one of free, commercial',
  })
  accessTier!: UserAccessTier;
}
