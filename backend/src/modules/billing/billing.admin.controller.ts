import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PricingService } from './pricing.service';

export interface BillingConfigDto {
  creditPriceToman: number;
  webSearchPriceToman: number;
}

/**
 * Admin: read-only view of the deployment's billing configuration (Phase 5
 * §1.5). There is deliberately no PATCH — the Credit price is deployment-level
 * configuration (env vars), so exposing an editor would imply a persistence
 * path that does not exist.
 */
@Controller('v1/admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class BillingAdminController {
  constructor(private readonly pricing: PricingService) {}

  @Get('config')
  getConfig(): BillingConfigDto {
    return {
      creditPriceToman: this.pricing.getCreditPriceToman(),
      webSearchPriceToman: this.pricing.getWebSearchPriceToman(),
    };
  }
}
