import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ModelsService } from './models.service';
import { Model } from './entities/model.entity';

/**
 * Public model-list endpoint for end users.
 *
 * Returns only enabled models with display names — actualName and
 * admin-only fields are never exposed. This surface is what the
 * frontend model picker consumes.
 */
@Controller('v1/models')
@UseGuards(JwtAuthGuard)
export class ModelsPublicController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.models.listEnabled();
    return { items: items.map((m) => this.toPublic(m)) };
  }

  private toPublic(model: Model): {
    id: string;
    displayName: string;
    isDefault: boolean;
  } {
    return {
      id: model.id,
      displayName: model.displayName,
      isDefault: model.isDefault,
    };
  }
}
