import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Model } from './entities/model.entity';

/**
 * Service for reading model catalog data.
 *
 * Public surface: list enabled models, resolve the active model for a
 * given user/request. Admin write operations live in a separate controller
 * (US7/US8).
 */
@Injectable()
export class ModelsService {
  constructor(
    @InjectRepository(Model)
    private readonly repo: Repository<Model>,
  ) {}

  /**
   * List all enabled models ordered by display name. Only fields safe
   * for end-user consumption are included.
   */
  async listEnabled(): Promise<Model[]> {
    return this.repo.find({
      where: { enabled: true },
      order: { displayName: 'ASC' },
    });
  }

  /**
   * Find any model by id regardless of enabled state. Used internally
   * by the active-model resolver and admin operations.
   */
  async findById(id: string): Promise<Model> {
    const model = await this.repo.findOne({ where: { id } });
    if (!model) throw new NotFoundException({ code: 'model_not_found', message: 'Model not found.' });
    return model;
  }

  /**
   * Resolve which model should be used for a chat request.
   *
   * Resolution order:
   *   1. explicitModelId (caller picked a model in the request body)
   *   2. caller's sticky choice (User.lastSelectedModelId)
   *   3. admin's default model (AppConfig.defaultModelId → Model.isDefault)
   *   4. null — caller surfaces 422 "no_model_available"
   *
   * Cross-module lookups (User, AppConfig) go through the TypeORM
   * manager directly to avoid circular module imports.
   *
   * @returns the resolved Model, or null when nothing is available.
   */
  async resolveActiveModel(params: {
    explicitModelId?: string | null;
    userId?: string | null;
  }): Promise<Model | null> {
    // 1. Explicit selection takes priority — user chose in-request.
    if (params.explicitModelId) {
      const explicit = await this.repo.findOne({
        where: { id: params.explicitModelId, enabled: true },
      });
      if (explicit) return explicit;
      // Explicit id not found or disabled → fall through (caller
      // surfaces 422 "no_model_available" when everything returns null).
    }

    // 2. Sticky user choice (User.lastSelectedModelId).
    if (params.userId) {
      const userRow = await this.repo.manager
        .createQueryBuilder()
        .select('last_selected_model_id')
        .from('users', 'u')
        .where('u.id = :uid', { uid: params.userId })
        .getRawOne<{ last_selected_model_id: string }>();

      const stickyId = userRow?.last_selected_model_id;
      if (stickyId) {
        const sticky = await this.repo.findOne({
          where: { id: stickyId, enabled: true },
        });
        if (sticky) return sticky;
      }
    }

    // 3. Admin default model (AppConfig.defaultModelId → Model).
    const appConfigRow = await this.repo.manager
      .createQueryBuilder()
      .select('ac.default_model_id')
      .from('app_config', 'ac')
      .where('ac.id = :sid', { sid: 'singleton' })
      .getRawOne<{ default_model_id: string }>();

    const defaultId = appConfigRow?.default_model_id;
    if (defaultId) {
      const defaultModel = await this.repo.findOne({
        where: { id: defaultId, enabled: true },
      });
      if (defaultModel) return defaultModel;
    }

    // 4. Nothing resolvable — caller surfaces 422.
    return null;
  }
}
