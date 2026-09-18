import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Provider } from './entities/provider.entity';
import { ProviderService, PROVIDER_ADAPTERS } from './provider.service';
import { ProviderController } from './provider.controller';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter';
import { ProviderRuntimeService } from './provider-runtime.service';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [TypeOrmModule.forFeature([Provider]), ModelsModule],
  controllers: [ProviderController],
  providers: [
    ProviderService,
    OpenAICompatibleAdapter,
    ProviderRuntimeService,
    {
      provide: PROVIDER_ADAPTERS,
      useFactory: (adapter: OpenAICompatibleAdapter) => [adapter],
      inject: [OpenAICompatibleAdapter],
    },
  ],
  exports: [ProviderService, OpenAICompatibleAdapter, ProviderRuntimeService, PROVIDER_ADAPTERS],
})
export class ProviderModule {}
