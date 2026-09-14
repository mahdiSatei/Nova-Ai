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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ModelsService } from './models.service';
import { ModelUpsertDto } from './dto/model-upsert.dto';

/**
 * Admin-only CRUD for the model catalog. US7.
 *
 * All endpoints require an admin JWT (JwtAuthGuard) plus the `admin`
 * role (RolesGuard). The full set: list all (including disabled),
 * create, partial update (displayName / actualName / enabled),
 * delete (refused with 409 when the model is still the default or
 * referenced by any conversation).
 */
@Controller('v1/admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ModelsAdminController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  async list() {
    const all = await this.models.listAll();
    return {
      items: all.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        actualName: m.actualName,
        enabled: m.enabled,
        isDefault: m.isDefault,
        createdAt: m.createdAt.toISOString(),
        updatedAt: m.updatedAt.toISOString(),
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: ModelUpsertDto) {
    const m = await this.models.create({
      displayName: body.displayName!,
      actualName: body.actualName!,
      enabled: body.enabled,
    });
    return this.toAdminShape(m);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: ModelUpsertDto) {
    const m = await this.models.update(id, {
      displayName: body.displayName,
      actualName: body.actualName,
      enabled: body.enabled,
    });
    return this.toAdminShape(m);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.models.delete(id);
  }

  private toAdminShape(m: {
    id: string;
    displayName: string;
    actualName: string;
    enabled: boolean;
    isDefault: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: m.id,
      displayName: m.displayName,
      actualName: m.actualName,
      enabled: m.enabled,
      isDefault: m.isDefault,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt.toISOString(),
    };
  }
}
