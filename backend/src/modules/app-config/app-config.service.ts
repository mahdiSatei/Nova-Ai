import {
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppConfig } from './entities/app-config.entity';
import { Model } from '../models/entities/model.entity';

export interface AppConfigPublic {
  defaultModelId: string | null;
}

/**
 * Service for the AppConfig singleton — currently only the
 * default-model reference. All mutations are atomic: the prior
 * default (if any) is cleared and the new default is set in a single
 * transaction.
 */
@Injectable()
export class AppConfigService {
  private readonly logger = new Logger(AppConfigService.name);

  constructor(
    @InjectRepository(AppConfig)
    private readonly configRepo: Repository<AppConfig>,
    @InjectRepository(Model)
    private readonly modelRepo: Repository<Model>,
    @InjectDataSource()
    private readonly ds: DataSource,
  ) {}

  async read(): Promise<AppConfigPublic> {
    const row = await this.configRepo.findOne({ where: { id: 'singleton' } });
    return { defaultModelId: row?.defaultModelId ?? null };
  }

  /**
   * Set or clear the default model. The prior `Model.isDefault = true`
   * row is cleared and the new default is set in a single
   * transaction so the invariant (at most one default) is never
   * violated, even briefly.
   */
  async update(input: { defaultModelId: string | null }): Promise<AppConfigPublic> {
    const nextId = input.defaultModelId ?? null;

    // Validate the model id when one is supplied.
    if (nextId !== null) {
      const m = await this.modelRepo.findOne({ where: { id: nextId } });
      if (!m) {
        throw new UnprocessableEntityException({
          code: 'model_not_found',
          message: 'The referenced model does not exist.',
        });
      }
      if (!m.enabled) {
        throw new UnprocessableEntityException({
          code: 'model_not_eligible_default',
          message: 'Only enabled models can be the default.',
        });
      }
    }

    await this.ds.transaction(async (em) => {
      // 1. Clear any existing default.
      await em
        .createQueryBuilder()
        .update(Model)
        .set({ isDefault: false })
        .where('is_default = :t', { t: true })
        .execute();

      // 2. Mark the new default.
      if (nextId !== null) {
        const r = await em
          .createQueryBuilder()
          .update(Model)
          .set({ isDefault: true })
          .where('id = :id', { id: nextId })
          .execute();
        if (r.affected === 0) {
          throw new UnprocessableEntityException({
            code: 'model_not_found',
            message: 'The referenced model does not exist.',
          });
        }
      }

      // 3. Persist AppConfig.defaultModelId.
      let cfg = await em.findOne(AppConfig, { where: { id: 'singleton' } });
      if (!cfg) {
        cfg = em.create(AppConfig, { id: 'singleton', defaultModelId: nextId });
      } else {
        cfg.defaultModelId = nextId;
      }
      await em.save(cfg);
    });

    return { defaultModelId: nextId };
  }
}
