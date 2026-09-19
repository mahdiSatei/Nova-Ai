import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ModelsService, DeleteModelMigrationResult } from './models.service';
import { ModelUpsertDto } from './dto/model-upsert.dto';
import { Model } from './entities/model.entity';
import { readStoredReasoningConfig, resolveReasoningConfig } from '../reasoning/reasoning.capability';

/**
 * Admin-only CRUD for the model catalog. US7.
 *
 * All endpoints require an admin JWT (JwtAuthGuard) plus the `admin`
 * role (RolesGuard). The full set: list all (including disabled),
 * create, partial update (displayName / actualName / enabled),
 * delete — refused with 409 while the model is still referenced
 * anywhere, unless `?migrateTo=<replacementId>` first re-points every
 * reference (conversations, user sticky picks, app default) to the
 * replacement model inside a single verified transaction.
 */
@Controller('v1/admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ModelsAdminController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  async list() {
    const all = await this.models.listAll();
    return { items: all.map((m) => this.toAdminShape(m)) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: ModelUpsertDto) {
    const m = await this.models.create({
      displayName: body.displayName!,
      actualName: body.actualName!,
      providerId: body.providerId!,
      visibility: body.visibility,
      enabled: body.enabled,
      fallbackModelId: body.fallbackModelId,
      reasoning: body.reasoning,
    });
    return this.toAdminShape(m);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: ModelUpsertDto) {
    const m = await this.models.update(id, {
      displayName: body.displayName,
      actualName: body.actualName,
      providerId: body.providerId,
      visibility: body.visibility,
      enabled: body.enabled,
      fallbackModelId: body.fallbackModelId,
      reasoning: body.reasoning,
    });
    return this.toAdminShape(m);
  }

  /** Re-run automatic capability discovery for a model (Phase 8). */
  @Post(':id/reasoning/discover')
  @HttpCode(HttpStatus.OK)
  async discoverReasoning(@Param('id') id: string) {
    const m = await this.models.rediscoverReasoning(id);
    return this.toAdminShape(m);
  }

  /**
   * Delete a model. Plain delete returns 204 and refuses with 409
   * while the model is still referenced anywhere. Passing
   * `?migrateTo=<replacementId>` first re-points every reference
   * (conversations, user sticky picks, app default) to the
   * replacement inside a single transaction, verifies zero remaining
   * references, and only then deletes — returning 200 with the
   * migration counts. Nothing is ever force-deleted.
   */
  @ApiQuery({
    name: 'migrateTo',
    required: false,
    type: String,
    description:
      'Optional replacement model id. When present, all references to the ' +
      'deleted model (conversations, user sticky picks, app default) are ' +
      're-pointed to it inside one verified transaction before deletion.',
  })
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Query('migrateTo') migrateTo: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DeleteModelMigrationResult | undefined> {
    const result = await this.models.delete(id, migrateTo ?? null);
    if (!result) {
      res.status(HttpStatus.NO_CONTENT);
      return undefined;
    }
    res.status(HttpStatus.OK);
    return result;
  }

  /**
   * Everything the admin UI needs to show and edit reasoning capability: the
   * effective configuration, the discovery snapshot with its per-capability
   * source, and the admin's own values.
   */
  private toReasoningShape(m: Model) {
    const stored = readStoredReasoningConfig(m.reasoningConfig);
    return {
      mode: stored.mode,
      effective: resolveReasoningConfig(stored),
      discovered: {
        supported: stored.discovered.supported,
        output: stored.discovered.output,
        streaming: stored.discovered.streaming,
        sources: stored.discovered.sources,
        discoveredAt: stored.discovered.discoveredAt,
      },
      manual: stored.manual,
    };
  }

  private toAdminShape(m: Model) {
    return {
      id: m.id,
      displayName: m.displayName,
      actualName: m.actualName,
      providerId: m.providerId,
      visibility: m.visibility,
      enabled: m.enabled,
      isDefault: m.isDefault,
      fallbackModelId: m.fallbackModelId ?? null,
      reasoning: this.toReasoningShape(m),
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
