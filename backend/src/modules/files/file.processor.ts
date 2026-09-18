import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileRecord, FileStatus } from './entities/file.entity';
import { FileContentService } from './file-content.service';
import { FILE_PROCESSING_QUEUE, EXTRACT_TEXT_JOB } from './files.constants';

@Processor(FILE_PROCESSING_QUEUE)
export class FileProcessor extends WorkerHost {
  private readonly logger = new Logger(FileProcessor.name);

  constructor(
    @InjectRepository(FileRecord)
    private readonly fileRepo: Repository<FileRecord>,
    private readonly fileContent: FileContentService,
  ) {
    super();
  }

  async process(job: Job<{ fileId: string }>): Promise<void> {
    if (job.name !== EXTRACT_TEXT_JOB) return;

    const { fileId } = job.data;
    const file = await this.fileRepo.findOne({ where: { id: fileId } });
    if (!file) {
      this.logger.warn(`File with id ${fileId} not found for async processing`);
      return;
    }

    try {
      file.status = FileStatus.PROCESSING;
      await this.fileRepo.save(file);

      const text = await this.fileContent.extractText(file);
      file.extractedText = text;
      file.status = FileStatus.READY;
      file.errorMessage = null;
      await this.fileRepo.save(file);

      this.logger.log(`File ${file.originalName} (${fileId}) processed successfully.`);
    } catch (err) {
      this.logger.error(`Error processing file ${fileId}: ${err instanceof Error ? err.message : String(err)}`);
      file.status = FileStatus.FAILED;
      file.errorMessage = err instanceof Error ? err.message : 'Unknown parsing error';
      await this.fileRepo.save(file);
    }
  }
}