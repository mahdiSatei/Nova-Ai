import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConversationSnapshot } from './entities/conversation-snapshot.entity';
import { SnapshotMessage } from './entities/snapshot-message.entity';
import { SharingService } from './sharing.service';
import { SharingController } from './sharing.controller';
import { SharingPublicController } from './sharing-public.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { ModelsModule } from '../models/models.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ConversationSnapshot, SnapshotMessage]),
    ConversationsModule,
    ModelsModule,
  ],
  controllers: [SharingController, SharingPublicController],
  providers: [SharingService],
  exports: [SharingService],
})
export class SharingModule {}
