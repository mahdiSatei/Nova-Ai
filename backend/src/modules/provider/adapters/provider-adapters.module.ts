import { Module } from '@nestjs/common';
import { OpenAICompatibleAdapter } from './openai-compatible.adapter';
import { PROVIDER_ADAPTERS } from '../provider.service';

/**
 * Leaf module that owns the provider adapter registry. It deliberately has no
 * dependency on ModelsModule, so the models module can inject adapters for
 * capability discovery without creating a circular module dependency.
 */
@Module({
  providers: [
    OpenAICompatibleAdapter,
    {
      provide: PROVIDER_ADAPTERS,
      useFactory: (adapter: OpenAICompatibleAdapter) => [adapter],
      inject: [OpenAICompatibleAdapter],
    },
  ],
  exports: [PROVIDER_ADAPTERS, OpenAICompatibleAdapter],
})
export class ProviderAdaptersModule {}
