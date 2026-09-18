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
   * Uploads the file to object storage and persists its metadata,
   * stamped with the owning user from the auth context.
   * Storage failures surface as a sanitized BadGateway — no internal
   * details leak to clients.
   */
  async create(file: Express.Multer.File, userId: string): Promise<FileRecord> {
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
      userId,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      fileKey: stored.fileKey,
      url: stored.url,
      status: FileStatus.UPLOADED,
    });
    return this.repo.save(record);
  }

  /**
   * Loads a file record owned by the given user. Ownership mismatch and
   * missing records both yield null so callers cannot distinguish them
   * (no id enumeration).
   */
  findOwned(fileId: string, userId: string): Promise<FileRecord | null> {
    return this.repo.findOne({ where: { id: fileId, userId } });
  }

  /** Persists a lifecycle status change (READY / FAILED after extraction). */
  async setStatus(record: FileRecord, status: FileStatus): Promise<void> {
    record.status = status;
    await this.repo.save(record);
  }
}
