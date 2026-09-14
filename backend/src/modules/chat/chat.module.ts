import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OpenAICompatibleClient } from './provider/openai-compatible.client';
import { CentralProvider } from '../provider/entities/central-provider.entity';
import { Model } from '../models/entities/model.entity';
import { User } from '../users/entities/user.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CentralProvider, Model, User]),
    ConversationsModule,
    ModelsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, OpenAICompatibleClient],
  exports: [ChatService],
})
export class ChatModule {}
