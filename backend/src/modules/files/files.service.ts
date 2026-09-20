import { Injectable, BadGatewayException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { StorageService } from './storage.service';
import { FileRecord, FileStatus } from './entities/file.entity';
import { FILE_PROCESSING_QUEUE, EXTRACT_TEXT_JOB } from './files.constants';
import { User } from '../users/entities/user.entity';

@Injectable()
export class FilesService {
  constructor(
    private readonly storage: StorageService,
    @InjectRepository(FileRecord)
    private readonly repo: Repository<FileRecord>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectQueue(FILE_PROCESSING_QUEUE)
    private readonly fileQueue: Queue,
  ) {}

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

    let cleanName = file.originalname;
    try {
      cleanName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      cleanName = file.originalname;
    }

    const record = this.repo.create({
      userId,
      originalName: cleanName,
      mimeType: file.mimetype,
      size: file.size,
      fileKey: stored.fileKey,
      url: stored.url,
      status: FileStatus.UPLOADED,
    });
    const saved = await this.repo.save(record);

    // افزودن جاب به صف پردازش ناهمگام
    await this.fileQueue.add(EXTRACT_TEXT_JOB, { fileId: saved.id });

    return saved;
  }

  findOwned(fileId: string, userId: string): Promise<FileRecord | null> {
    return this.repo.findOne({ where: { id: fileId, userId } });
  }

  async setStatus(record: FileRecord, status: FileStatus): Promise<void> {
    record.status = status;
    await this.repo.save(record);
  }

  async findAllAdmin(
    limit = 20,
    offset = 0,
    filters?: { status?: FileStatus; mimeType?: string; userId?: string },
  ): Promise<{ items: (FileRecord & { username?: string | null })[]; total: number }> {
    const where: FindOptionsWhere<FileRecord> = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.mimeType) where.mimeType = filters.mimeType;
    if (filters?.userId) where.userId = filters.userId;

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    // واکشی نام کاربری برای هر فایل
    const userIds = [...new Set(items.map((i) => i.userId))];
    const users = await this.userRepo.findByIds(userIds);
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    const itemsWithUsername = items.map((item) => ({
      ...item,
      username: userMap.get(item.userId) || 'Unknown',
    }));

    return { items: itemsWithUsername, total };
  }
}