import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Provider } from './entities/provider.entity';
import { ProviderService } from './provider.service';
import { ProviderController } from './provider.controller';
import { ProviderAdaptersModule } from './adapters/provider-adapters.module';
import { ProviderRuntimeService } from './provider-runtime.service';
import { ProviderFailoverService } from './provider-failover.service';
import { ProviderAttemptMetrics } from './provider-attempt-metrics.service';
import { ProviderAdminController } from './provider.admin.controller';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [TypeOrmModule.forFeature([Provider]), ModelsModule, ProviderAdaptersModule],
  controllers: [ProviderController, ProviderAdminController],
  providers: [
    ProviderService,
    ProviderRuntimeService,
    ProviderFailoverService,
    ProviderAttemptMetrics,
  ],
  exports: [
    ProviderService,
    ProviderAdaptersModule,
    ProviderRuntimeService,
    ProviderFailoverService,
    ProviderAttemptMetrics,
  ],
})
export class ProviderModule {}
