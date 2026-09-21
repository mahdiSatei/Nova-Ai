import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ProviderAttemptMetrics,
  ProviderMetricsSnapshot,
} from './provider-attempt-metrics.service';

/**
 * Admin observability for provider fallback (spec 006). Counters describe the
 * running process and reset on restart.
 */
@Controller('v1/admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ProviderAdminController {
  constructor(private readonly attemptMetrics: ProviderAttemptMetrics) {}

  @Get('provider-metrics')
  metrics(): ProviderMetricsSnapshot {
    return this.attemptMetrics.snapshot();
  }
}
