import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Provider } from './entities/provider.entity';
import { ProviderService, PROVIDER_ADAPTERS } from './provider.service';
import { ProviderController } from './provider.controller';
import { OpenAICompatibleAdapter } from './adapters/openai-compatible.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([Provider])],
  controllers: [ProviderController],
  providers: [
    ProviderService,
    OpenAICompatibleAdapter,
    {
      provide: PROVIDER_ADAPTERS,
      useFactory: (adapter: OpenAICompatibleAdapter) => [adapter],
      inject: [OpenAICompatibleAdapter],
    },
  ],
  exports: [ProviderService, OpenAICompatibleAdapter],
})
export class ProviderModule {}
