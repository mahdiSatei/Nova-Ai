import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Provider } from './entities/provider.entity';
import { ProviderService, PROVIDER_ADAPTERS } from './provider.service';
import { ProviderController } from './provider.controller';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter';
import { ProviderRuntimeService } from './provider-runtime.service';
import { ProviderFailoverService } from './provider-failover.service';
import { ProviderAttemptMetrics } from './provider-attempt-metrics.service';
import { ProviderAdminController } from './provider.admin.controller';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [TypeOrmModule.forFeature([Provider]), ModelsModule],
  controllers: [ProviderController, ProviderAdminController],
  providers: [
    ProviderService,
    OpenAICompatibleAdapter,
    ProviderRuntimeService,
    ProviderFailoverService,
    ProviderAttemptMetrics,
    {
      provide: PROVIDER_ADAPTERS,
      useFactory: (adapter: OpenAICompatibleAdapter) => [adapter],
      inject: [OpenAICompatibleAdapter],
    },
  ],
  exports: [
    ProviderService,
    OpenAICompatibleAdapter,
    ProviderRuntimeService,
    ProviderFailoverService,
    ProviderAttemptMetrics,
    PROVIDER_ADAPTERS,
  ],
})
export class ProviderModule {}
