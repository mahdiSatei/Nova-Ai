import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BadGatewayException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { FileRecord, FileStatus } from './entities/file.entity';

@Injectable()
export class FilesService {
  constructor(
    private readonly storage: StorageService,
    @InjectRepository(FileRecord)
    private readonly repo: Repository<FileRecord>,
  ) {}

  /**
   * Uploads the file to object storage and persists its metadata.
   * Storage failures surface as a sanitized BadGateway — no internal
   * details leak to clients.
   */
  async create(file: Express.Multer.File): Promise<FileRecord> {
    let stored: { fileKey: string; url: string };
    try {
      stored = await this.storage.uploadFile(file);
    } catch (err) {
      throw new BadGatewayException({
        code: 'storage_unavailable',
        message: 'File storage is currently unavailable.',
        cause: err instanceof Error ? err.message : undefined,
      });
    }

    const record = this.repo.create({
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      fileKey: stored.fileKey,
      url: stored.url,
      status: FileStatus.UPLOADED,
    });
    return this.repo.save(record);
  }
}
