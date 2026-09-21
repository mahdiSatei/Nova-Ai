import { Module } from '@nestjs/common';
import { SerpexProvider } from './adapters/serpex.provider';
import { WebSearchService } from './web-search.service';
import { WEB_SEARCH_PROVIDER } from './web-search-provider.interface';

@Module({
  providers: [
    SerpexProvider,
    {
      provide: WEB_SEARCH_PROVIDER,
      useFactory: (provider: SerpexProvider) => provider,
      inject: [SerpexProvider],
    },
    WebSearchService,
  ],
  exports: [WebSearchService, WEB_SEARCH_PROVIDER],
})
export class WebSearchModule {}
