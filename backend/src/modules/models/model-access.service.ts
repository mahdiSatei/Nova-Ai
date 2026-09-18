import { ForbiddenException, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { ModelVisibility, UserAccessTier, TIER_RANK, VISIBILITY_RANK } from './model-visibility';

/** The caller's entitlement, resolved once per request. */
export interface AccessViewer {
  role: 'user' | 'admin';
  accessTier: UserAccessTier;
}

/** The minimum a model must expose for the policy to decide. */
export interface AccessTarget {
  visibility: ModelVisibility;
  enabled: boolean;
}

/**
 * The ONE place model entitlement is decided (spec 003 — "Backend
 * authorization guard/service").
 *
 * Policy:
 *   - a disabled model is usable by nobody (including admins) — callers keep
 *     returning the pre-existing `model_unavailable` error for that case;
 *   - `private` models are admin-only;
 *   - otherwise the viewer's tier must be >= the model's visibility rank
 *     (free < commercial); admins hold the maximum tier.
 *
 * Entitlement is read from the database on every request rather than from the
 * JWT so an access-tier change takes effect immediately. A missing user row
 * denies everything.
 */
@Injectable()
export class ModelAccessService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async loadViewer(userId: string): Promise<AccessViewer | null> {
    const row = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'role', 'accessTier'],
    });
    if (!row) return null;
    return { role: row.role, accessTier: row.accessTier };
  }

  canAccess(viewer: AccessViewer | null | undefined, model: AccessTarget): boolean {
    if (!viewer) return false;
    if (!model.enabled) return false;
    if (model.visibility === 'private') return viewer.role === 'admin';
    const tier: UserAccessTier = viewer.role === 'admin' ? 'commercial' : viewer.accessTier;
    return TIER_RANK[tier] >= VISIBILITY_RANK[model.visibility];
  }

  async canAccessUser(userId: string, model: AccessTarget): Promise<boolean> {
    return this.canAccess(await this.loadViewer(userId), model);
  }

  async filterAccessible<T extends AccessTarget>(userId: string, models: T[]): Promise<T[]> {
    const viewer = await this.loadViewer(userId);
    return models.filter((m) => this.canAccess(viewer, m));
  }

  /**
   * Endpoint gate. Callers use this instead of hand-rolling `enabled` checks so
   * "turned off" and "not yours" stay distinguishable to clients.
   */
  async assertCanUseModel(userId: string, model: AccessTarget): Promise<void> {
    if (!model.enabled) {
      throw new UnprocessableEntityException({
        code: 'model_unavailable',
        message: 'The selected model is not available.',
      });
    }
    if (!(await this.canAccessUser(userId, model))) {
      throw new ForbiddenException({
        code: 'model_forbidden',
        message: 'You do not have access to this model.',
      });
    }
  }
}
