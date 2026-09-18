import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FilesController } from './files.controller';
import { FilesService } from './files.service';
import { FileContentService } from './file-content.service';
import { FileRecord } from './entities/file.entity';
import { StorageModule } from './storage.service';

@Module({
  imports: [TypeOrmModule.forFeature([FileRecord]), StorageModule],
  controllers: [FilesController],
  providers: [FilesService, FileContentService],
  exports: [FilesService, FileContentService],
})
export class FilesModule {}
