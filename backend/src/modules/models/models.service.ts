import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Model } from './entities/model.entity';
import { AppConfig } from '../app-config/entities/app-config.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { User } from '../users/entities/user.entity';
import { ModelAccessService } from './model-access.service';
import { MODEL_VISIBILITIES, ModelVisibility } from './model-visibility';
import { ReasoningCapabilityService } from './reasoning-capability.service';
import {
  assertValidReasoningCapability,
  readStoredReasoningConfig,
} from '../reasoning/reasoning.capability';
import {
  EMPTY_REASONING_CONFIG,
  ReasoningCapability,
  ReasoningConfigInput,
  StoredReasoningConfig,
} from '../reasoning/reasoning.types';

export interface CreateModelInput {
  displayName: string;
  actualName: string;
  providerId: string;
  visibility?: ModelVisibility;
  enabled?: boolean;
  /** Model used when this model's provider fails (spec 006). One hop only. */
  fallbackModelId?: string | null;
  /** Pin this model to a specific API key; null clears the pin. */
  preferredApiKeyId?: string | null;
  /** Phase 8 — admin reasoning capability configuration. */
  reasoning?: ReasoningConfigInput;
}

export interface UpdateModelInput {
  displayName?: string;
  actualName?: string;
  providerId?: string;
  visibility?: ModelVisibility;
  enabled?: boolean;
  /** `null` clears the fallback; absent leaves it untouched. */
  fallbackModelId?: string | null;
  /** `null` clears the preferred key; absent leaves it untouched. */
  preferredApiKeyId?: string | null;
  /** Phase 8 — admin reasoning capability configuration. */
  reasoning?: ReasoningConfigInput;
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
  private readonly logger = new Logger(ModelsService.name);

  constructor(
    @InjectRepository(Model)
    private readonly repo: Repository<Model>,
    private readonly access: ModelAccessService,
    private readonly reasoningCapability: ReasoningCapabilityService,
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
   * The catalog a given user may pick from: enabled models filtered by the
   * access policy (spec 003 — "Filter model catalog by current user").
   * `listEnabled()` stays as the unfiltered primitive used internally.
   */
  async listAccessibleFor(userId: string): Promise<Model[]> {
    const enabled = await this.listEnabled();
    return this.access.filterAccessible(userId, enabled);
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
   * Resolution order (every candidate is checked against the access policy):
   *   1. explicitModelId (caller picked a model in the request body)
   *   2. caller's sticky choice (User.lastSelectedModelId)
   *   3. admin's default model (AppConfig.defaultModelId → Model.isDefault)
   *   4. null — caller surfaces 422 "no_model_available"
   *
   * The viewer is loaded ONCE so all three candidates share a single
   * entitlement read. `userId` is required: without a viewer nothing is
   * resolvable, which stops a caller that forgets to pass the user from
   * silently handing out restricted models.
   */
  async resolveActiveModel(params: {
    explicitModelId?: string | null;
    userId?: string | null;
  }): Promise<Model | null> {
    if (!params.userId) {
      this.logger.warn('resolveActiveModel called without userId; refusing to resolve a model');
      return null;
    }
    const viewer = await this.access.loadViewer(params.userId);

    // 1. Explicit selection takes priority — user chose in-request.
    if (params.explicitModelId) {
      const explicit = await this.repo.findOne({ where: { id: params.explicitModelId } });
      if (explicit && this.access.canAccess(viewer, explicit)) return explicit;
    }

    // 2. Sticky user choice (User.lastSelectedModelId).
    const userRow = await this.repo.manager
      .createQueryBuilder()
      .select('last_selected_model_id')
      .from('users', 'u')
      .where('u.id = :uid', { uid: params.userId })
      .getRawOne<{ last_selected_model_id: string }>();

    const stickyId = userRow?.last_selected_model_id;
    if (stickyId) {
      const sticky = await this.repo.findOne({ where: { id: stickyId } });
      if (sticky && this.access.canAccess(viewer, sticky)) return sticky;
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
      const defaultModel = await this.repo.findOne({ where: { id: defaultId } });
      if (defaultModel && this.access.canAccess(viewer, defaultModel)) return defaultModel;
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

    await this.assertValidFallback(null, input.fallbackModelId);

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

    // Discovery always runs on create so an automatic model has a snapshot, and
    // a manual model still shows the admin what the provider reports.
    const reasoningConfig = await this.buildReasoningConfig(EMPTY_REASONING_CONFIG, input.reasoning, {
      providerId: input.providerId,
      modelName: actualName,
      refreshDiscovery: true,
    });

    const created = this.repo.create({
      displayName,
      actualName,
      providerId: input.providerId,
      visibility: input.visibility ?? 'public',
      enabled,
      isDefault: false,
      fallbackModelId: input.fallbackModelId ?? null,
      preferredApiKeyId: input.preferredApiKeyId ?? null,
      reasoningConfig,
    });
    return this.repo.save(created);
  }

  /**
   * A fallback must be a different, enabled model on an active provider.
   *
   * Validating in the service (not only in the DTO) means the rule holds for
   * every caller, including the scripts under `scripts/`, and it is the only
   * place that can catch a self-reference on create, where the id does not
   * exist yet.
   */
  private async assertValidFallback(
    modelId: string | null,
    fallbackModelId: string | null | undefined,
  ): Promise<void> {
    if (fallbackModelId === undefined || fallbackModelId === null) return;

    if (fallbackModelId === modelId) {
      throw new UnprocessableEntityException({
        code: 'invalid_fallback_model',
        message: 'A model cannot fall back to itself.',
      });
    }

    const fallback = await this.repo.findOne({ where: { id: fallbackModelId } });
    if (!fallback || !fallback.enabled) {
      throw new UnprocessableEntityException({
        code: 'invalid_fallback_model',
        message: 'The fallback model must exist and be enabled.',
      });
    }

    // Raw query rather than an injected Provider repository — this is the same
    // pattern `create` already uses to check the primary provider.
    const provider = await this.repo.manager
      .createQueryBuilder()
      .select('is_active')
      .from('providers', 'p')
      .where('p.id = :pid', { pid: fallback.providerId })
      .getRawOne<{ is_active: boolean }>();
    if (!provider || !provider.is_active) {
      throw new UnprocessableEntityException({
        code: 'invalid_fallback_model',
        message: 'The fallback model must be on an active provider.',
      });
    }
  }

  /**
   * Admin: partial update of a model. Enforces the "only enabled
   * model can be isDefault" invariant: if the model is currently
   * the default and the admin disables it, isDefault is cleared.
   * Also enforces that enabled models reference active providers.
   */
  async update(id: string, input: UpdateModelInput): Promise<Model> {
    const model = await this.findById(id);

    await this.assertValidFallback(id, input.fallbackModelId);
    if (input.fallbackModelId !== undefined) {
      model.fallbackModelId = input.fallbackModelId;
    }
    if (input.preferredApiKeyId !== undefined) {
      model.preferredApiKeyId = input.preferredApiKeyId;
    }

    const reasoningBase = readStoredReasoningConfig(model.reasoningConfig);
    const identityChanged =
      (input.actualName !== undefined && input.actualName !== model.actualName) ||
      (input.providerId !== undefined && input.providerId !== model.providerId);
    const switchedToAutomatic =
      input.reasoning?.mode === 'automatic' && reasoningBase.mode !== 'automatic';

    model.reasoningConfig = await this.buildReasoningConfig(reasoningBase, input.reasoning, {
      providerId: input.providerId ?? model.providerId,
      modelName: input.actualName ?? model.actualName,
      refreshDiscovery: identityChanged || switchedToAutomatic,
    });

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
    if (input.visibility !== undefined) {
      if (!MODEL_VISIBILITIES.includes(input.visibility)) {
        throw new UnprocessableEntityException({
          code: 'validation_failed',
          message: 'visibility must be one of public, commercial, private.',
        });
      }
      // Invariant: the configured system default must stay usable by every
      // user. Demoting it would silently strand the default for most users,
      // so refuse and let the admin pick another default first.
      const cfg = await this.repo.manager
        .createQueryBuilder()
        .select('ac.default_model_id', 'default_model_id')
        .from('app_config', 'ac')
        .where('ac.id = :sid', { sid: 'singleton' })
        .getRawOne<{ default_model_id: string | null }>();
      if (input.visibility !== 'public' && (model.isDefault || cfg?.default_model_id === id)) {
        throw new ConflictException({
          code: 'model_is_default',
          message: 'This model is the system default. Choose another default before restricting its visibility.',
        });
      }
      model.visibility = input.visibility;
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
   * Build the persisted reasoning snapshot.
   *
   * Discovery is re-run whenever the provider-side identity may have changed, so
   * the admin always sees what the provider currently reports. Manual values are
   * validated as a triple, so a contradictory configuration can never be stored.
   */
  private async buildReasoningConfig(
    base: StoredReasoningConfig,
    patch: ReasoningConfigInput | undefined,
    context: { providerId: string; modelName: string; refreshDiscovery: boolean },
  ): Promise<StoredReasoningConfig> {
    const mode = patch?.mode ?? base.mode;

    const manual: ReasoningCapability = {
      supported: patch?.supported !== undefined ? patch.supported : base.manual.supported,
      output: patch?.output !== undefined ? patch.output : base.manual.output,
      streaming: patch?.streaming !== undefined ? patch.streaming : base.manual.streaming,
    };
    try {
      assertValidReasoningCapability(manual);
    } catch (err) {
      // A cross-field rule that class-validator cannot express must still surface
      // as a client error, not a 500.
      throw new UnprocessableEntityException({
        code: 'invalid_reasoning_configuration',
        message: err instanceof Error ? err.message : 'Invalid reasoning configuration.',
      });
    }

    let discovered = base.discovered;
    if (context.refreshDiscovery) {
      const result = await this.reasoningCapability.discover({
        providerId: context.providerId,
        modelName: context.modelName,
      });
      discovered = {
        supported: result.capability.supported,
        output: result.capability.output,
        streaming: result.capability.streaming,
        sources: result.sources,
        discoveredAt: result.discoveredAt,
      };
    }

    return { mode, discovered, manual };
  }

  /**
   * Admin: re-run capability discovery and persist the snapshot. Manual values
   * are left untouched — discovery is never the final authority for them.
   */
  async rediscoverReasoning(id: string): Promise<Model> {
    const model = await this.findById(id);
    model.reasoningConfig = await this.buildReasoningConfig(
      readStoredReasoningConfig(model.reasoningConfig),
      undefined,
      { providerId: model.providerId, modelName: model.actualName, refreshDiscovery: true },
    );
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
