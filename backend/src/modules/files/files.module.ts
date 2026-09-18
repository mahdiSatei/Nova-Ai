import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileContentService } from './file-content.service';
import { FileProcessor } from './file.processor';
import { FileRecord } from './entities/file.entity';
import { StorageModule } from './storage.service';
import { FILE_PROCESSING_QUEUE } from './files.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord]),
    StorageModule,
    BullModule.registerQueue({
      name: FILE_PROCESSING_QUEUE,
    }),
  ],
  controllers: [FilesController],
  providers: [FilesService, FileContentService, FileProcessor],
  exports: [FilesService, FileContentService],
})
export class FilesModule {}