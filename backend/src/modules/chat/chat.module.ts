import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { Model } from '../models/entities/model.entity';
import { User } from '../users/entities/user.entity';
import { Provider } from '../provider/entities/provider.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { ModelsModule } from '../models/models.module';
import { ProviderModule } from '../provider/provider.module';
import { UsageModule } from '../usage/usage.module';
import { BillingModule } from '../billing/billing.module';
import { WebSearchModule } from '../web-search/web-search.module';
import { FilesModule } from '../files/files.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Model, User, Provider]),
    ConversationsModule,
    ModelsModule,
    ProviderModule,
    UsageModule,
    BillingModule,
    WebSearchModule,
    FilesModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}