import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Model } from './entities/model.entity';
import { AppConfig } from '../app-config/entities/app-config.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { User } from '../users/entities/user.entity';

export interface CreateModelInput {
  displayName: string;
  actualName: string;
  providerId: string;
  enabled?: boolean;
}

export interface UpdateModelInput {
  displayName?: string;
  actualName?: string;
  providerId?: string;
  enabled?: boolean;
}

export interface DeleteModelMigrationResult {
  deleted: true;
  migrated: {
    conversations: number;
    users: number;
    defaultSwitched: boolean;
  };
}

interface ModelReferences {
  conversations: number;
  users: number;
  isDefault: boolean;
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
   * (case-insensitive), the actual-name length constraints, and
   * provider association rules.
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

    const provider = await this.repo.manager
      .createQueryBuilder()
      .select('is_active')
      .from('providers', 'p')
      .where('p.id = :pid', { pid: input.providerId })
      .getRawOne<{ is_active: boolean }>();
    if (!provider || !provider.is_active) {
      throw new UnprocessableEntityException({
        code: 'provider_not_available',
        message: enabled
          ? 'Cannot create an enabled model for an inactive provider. Activate the provider first or create the model as disabled.'
          : 'The referenced provider does not exist or is inactive.',
      });
    }

    const created = this.repo.create({
      displayName,
      actualName,
      providerId: input.providerId,
      enabled,
      isDefault: false,
    });
    return this.repo.save(created);
  }

  /**
   * Admin: partial update of a model. Enforces the "only enabled
   * model can be isDefault" invariant: if the model is currently
   * the default and the admin disables it, isDefault is cleared.
   * Also enforces that enabled models reference active providers.
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
    if (input.providerId !== undefined) {
      model.providerId = input.providerId;
    }
    if (input.enabled !== undefined) {
      model.enabled = input.enabled;
      // Invariant: a disabled model cannot be the default. Toggling
      // enabled=false on the current default clears isDefault.
      if (input.enabled === false && model.isDefault) {
        model.isDefault = false;
      }
    }

    // After applying updates, validate that an enabled model references an active provider.
    if (model.enabled) {
      const provider = await this.repo.manager
        .createQueryBuilder()
        .select('is_active')
        .from('providers', 'p')
        .where('p.id = :pid', { pid: model.providerId })
        .getRawOne<{ is_active: boolean }>();
      if (!provider || !provider.is_active) {
        throw new UnprocessableEntityException({
          code: 'provider_not_available',
          message: 'Cannot enable a model whose provider is inactive. Activate the provider first.',
        });
      }
    }

    return this.repo.save(model);
  }

  /**
   * Count every live reference to a model: conversations (history),
   * user sticky selections, and the app default pointer.
   */
  async countReferences(id: string): Promise<ModelReferences> {
    const manager = this.repo.manager;
    const convCount = await manager
      .createQueryBuilder()
      .select('COUNT(*)', 'c')
      .from('conversations', 'c')
      .where('c.model_id = :id', { id })
      .getRawOne<{ c: string }>();
    const userCount = await manager
      .createQueryBuilder()
      .select('COUNT(*)', 'c')
      .from('users', 'u')
      .where('u.last_selected_model_id = :id', { id })
      .getRawOne<{ c: string }>();
    const cfg = await manager
      .createQueryBuilder()
      .select('ac.default_model_id', 'default_model_id')
      .from('app_config', 'ac')
      .where('ac.id = :sid', { sid: 'singleton' })
      .getRawOne<{ default_model_id: string | null }>();
    return {
      conversations: Number(convCount?.c ?? 0),
      users: Number(userCount?.c ?? 0),
      isDefault: cfg?.default_model_id === id,
    };
  }

  /**
   * Admin: delete a model.
   *
   * Without `migrateTo`: refuses with 409 when the model is still
   * referenced anywhere (default pointer, conversations, user sticky
   * picks) — the message reports the reference counts.
   *
   * With `migrateTo`: performs the safe migration first — inside a
   * single transaction every reference (conversations, users,
   * app default + is_default flag) is switched to the replacement
   * model, the remaining-reference count is verified to be zero, and
   * only then is the old model deleted. Nothing is force-deleted:
   * history is re-pointed, not destroyed, so the chatbot keeps
   * working on the replacement with zero downtime.
   */
  async delete(id: string, migrateTo?: string | null): Promise<DeleteModelMigrationResult | null> {
    await this.findById(id);

    const refs = await this.countReferences(id);

    if (!migrateTo) {
      if (refs.isDefault) {
        throw new ConflictException({
          code: 'model_in_use',
          message: `Cannot delete: this model is the system default. Set a different default first (or delete with migrateTo=<replacementId>).`,
        });
      }
      if (refs.conversations > 0 || refs.users > 0) {
        throw new ConflictException({
          code: 'model_in_use',
          message: `Cannot delete: still referenced by ${refs.conversations} conversation(s) and ${refs.users} user selection(s). Delete with migrateTo=<replacementId> to switch them to another model first.`,
        });
      }
      await this.repo.delete(id);
      return null;
    }

    // ── Migration path: switch everything to the replacement, then delete.
    if (migrateTo === id) {
      throw new ConflictException({
        code: 'replacement_not_available',
        message: 'The replacement model must be a different model.',
      });
    }
    const replacement = await this.repo.findOne({ where: { id: migrateTo } });
    if (!replacement) {
      throw new UnprocessableEntityException({
        code: 'replacement_not_available',
        message: 'The replacement model does not exist.',
      });
    }
    if (!replacement.enabled) {
      throw new UnprocessableEntityException({
        code: 'replacement_not_available',
        message: 'Only enabled models can replace a deleted model.',
      });
    }

    return this.repo.manager.transaction(async (em) => {
      const convResult = await em
        .getRepository(Conversation)
        .update({ modelId: id }, { modelId: migrateTo });
      const userResult = await em
        .getRepository(User)
        .update({ lastSelectedModelId: id }, { lastSelectedModelId: migrateTo });

      // The old model being the app default: promote the replacement to
      // default (clearing any stale is_default flags) before removing it.
      const cfgResult = await em
        .getRepository(AppConfig)
        .update({ defaultModelId: id }, { defaultModelId: migrateTo });
      const defaultSwitched = Number(cfgResult.affected ?? 0) > 0;
      if (defaultSwitched) {
        await em
          .getRepository(Model)
          .update({ isDefault: true }, { isDefault: false });
        await em
          .getRepository(Model)
          .update({ id: migrateTo }, { isDefault: true });
      }

      // Verify no references remain BEFORE the delete (step 3 of the
      // safe-deletion protocol). A non-zero count aborts the whole
      // transaction, so the old model stays fully intact.
      const leftoverConvs = await em
        .createQueryBuilder()
        .select('COUNT(*)', 'c')
        .from('conversations', 'c')
        .where('c.model_id = :id', { id })
        .getRawOne<{ c: string }>();
      const leftoverUsers = await em
        .createQueryBuilder()
        .select('COUNT(*)', 'c')
        .from('users', 'u')
        .where('u.last_selected_model_id = :id', { id })
        .getRawOne<{ c: string }>();
      const leftoverCfg = await em
        .createQueryBuilder()
        .select('ac.default_model_id', 'd')
        .from('app_config', 'ac')
        .where('ac.id = :sid', { sid: 'singleton' })
        .getRawOne<{ d: string | null }>();
      if (
        Number(leftoverConvs?.c ?? 0) > 0 ||
        Number(leftoverUsers?.c ?? 0) > 0 ||
        leftoverCfg?.d === id
      ) {
        throw new ConflictException({
          code: 'model_in_use',
          message: 'Migration verification failed: references to the model still exist. Nothing was deleted.',
        });
      }

      await em.delete(Model, id);

      return {
        deleted: true as const,
        migrated: {
          conversations: Number(convResult.affected ?? 0),
          users: Number(userResult.affected ?? 0),
          defaultSwitched,
        },
      };
    });
  }
}
