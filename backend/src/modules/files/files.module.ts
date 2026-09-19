import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { FilesController } from './files.controller';
import { FilesAdminController } from './files.admin.controller'; // ✨ ۱. ایمپورت کنترلر ادمین
import { FilesService } from './files.service';
import { FileContentService } from './file-content.service';
import { FileProcessor } from './file.processor';
import { FileRecord } from './entities/file.entity';
import { StorageModule } from './storage.service'; // یا مسیر استوریج شما
import { FILE_PROCESSING_QUEUE } from './files.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileRecord]),
    StorageModule,
    BullModule.registerQueue({
      name: FILE_PROCESSING_QUEUE,
    }),
  ],
  controllers: [FilesController, FilesAdminController], // ✨ ۲. اضافه کردن به لیست کنترلرها
  providers: [FilesService, FileContentService, FileProcessor],
  exports: [FilesService, FileContentService],
})
export class FilesModule {}