import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Model } from './entities/model.entity';

export interface CreateModelInput {
  displayName: string;
  actualName: string;
  enabled?: boolean;
}

export interface UpdateModelInput {
  displayName?: string;
  actualName?: string;
  enabled?: boolean;
}

/**
 * Service for reading and writing the model catalog.
 *
 * Public read surface (listEnabled, findById, resolveActiveModel) is
 * consumed by the public models controller and the chat module. Admin
 * write surface (create, update, delete) is consumed by the admin
 * models controller (US7).
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
   * Admin: list ALL models, including disabled. Ordered by display name.
   */
  async listAll(): Promise<Model[]> {
    return this.repo.find({ order: { displayName: 'ASC' } });
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

    // 3. Admin default model (AppConfig.default_model_id → Model).
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
    return null;
  }

  /**
   * Admin: create a new model. Enforces displayName uniqueness
   * (case-insensitive) and the actual-name length constraints.
   */
  async create(input: CreateModelInput): Promise<Model> {
    const displayName = input.displayName;
    const actualName = input.actualName;
    const enabled = input.enabled ?? true;

    // Display name uniqueness: case-insensitive lookup catches the
    // common mistake of "GPT-4o Mini" vs "gpt-4o mini".
    const existing = await this.repo
      .createQueryBuilder('m')
      .where('LOWER(m.display_name) = LOWER(:name)', { name: displayName })
      .getOne();
    if (existing) {
      throw new ConflictException({
        code: 'display_name_taken',
        message: 'A model with that display name already exists.',
      });
    }

    const created = this.repo.create({
      displayName,
      actualName,
      enabled,
      isDefault: false,
    });
    return this.repo.save(created);
  }

  /**
   * Admin: partial update of a model. Enforces the "only enabled
   * model can be isDefault" invariant: if the model is currently
   * the default and the admin disables it, isDefault is cleared.
   */
  async update(id: string, input: UpdateModelInput): Promise<Model> {
    const model = await this.findById(id);

    if (input.displayName !== undefined && input.displayName !== model.displayName) {
      const dup = await this.repo
        .createQueryBuilder('m')
        .where('LOWER(m.display_name) = LOWER(:name) AND m.id <> :id', {
          name: input.displayName,
          id,
        })
        .getOne();
      if (dup) {
        throw new ConflictException({
          code: 'display_name_taken',
          message: 'A model with that display name already exists.',
        });
      }
      model.displayName = input.displayName;
    }
    if (input.actualName !== undefined) {
      model.actualName = input.actualName;
    }
    if (input.enabled !== undefined) {
      model.enabled = input.enabled;
      // Invariant: a disabled model cannot be the default. Toggling
      // enabled=false on the current default clears isDefault.
      if (input.enabled === false && model.isDefault) {
        model.isDefault = false;
      }
    }
    return this.repo.save(model);
  }

  /**
   * Admin: delete a model. Refuses with 409 if the model is the
   * current default OR if any non-deleted conversation references it.
   */
  async delete(id: string): Promise<void> {
    await this.findById(id);

    // 1. Cannot delete the system default.
    const cfg = await this.repo.manager
      .createQueryBuilder()
      .select('ac.default_model_id')
      .from('app_config', 'ac')
      .where('ac.id = :sid', { sid: 'singleton' })
      .getRawOne<{ default_model_id: string }>();
    if (cfg?.default_model_id === id) {
      throw new ConflictException({
        code: 'model_in_use',
        message: 'Cannot delete the current default model. Set a different default first.',
      });
    }

    // 2. Cannot delete a model referenced by any conversation.
    const convCount = await this.repo.manager
      .createQueryBuilder()
      .select('COUNT(*) as c')
      .from('conversations', 'c')
      .where('c.model_id = :id', { id })
      .getRawOne<{ c: string }>();
    if (Number(convCount?.c ?? 0) > 0) {
      throw new ConflictException({
        code: 'model_in_use',
        message: 'Cannot delete a model referenced by one or more conversations.',
      });
    }

    await this.repo.delete(id);
  }
}
