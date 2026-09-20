import { Controller, Get, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { ModelsService } from './models.service';
import { Model } from './entities/model.entity';
import {
  readStoredReasoningConfig,
  resolveReasoningConfig,
  toPublicReasoning,
} from '../reasoning/reasoning.capability';

/**
 * Public model-list endpoint for end users.
 *
 * Returns only the enabled models the caller is entitled to use, with display
 * names — actualName and admin-only fields are never exposed. Models whose
 * visibility the caller does not satisfy are never returned, so the frontend
 * model picker can never offer an inaccessible model.
 */
@Controller('v1/models')
@UseGuards(JwtAuthGuard)
export class ModelsPublicController {
  constructor(private readonly models: ModelsService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async list(@CurrentUser() user: AuthenticatedUser) {
    const items = await this.models.listAccessibleFor(user.id);
    return { items: items.map((m) => this.toPublic(m)) };
  }

  private toPublic(model: Model): {
    id: string;
    displayName: string;
    isDefault: boolean;
    reasoning: { supported: boolean; output: 'none' | 'summary'; streaming: boolean };
    providerName: string | null;
  } {
    return {
      id: model.id,
      displayName: model.displayName,
      isDefault: model.isDefault,
      providerName: model.provider?.name ?? null,
      // Effective capability only — never the raw discovered/manual snapshot.
      reasoning: toPublicReasoning(
        resolveReasoningConfig(readStoredReasoningConfig(model.reasoningConfig)),
      ),
    };
  }
}
