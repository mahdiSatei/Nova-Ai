import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import { StorageService } from './storage.service';
import { FileRecord, FileStatus } from './entities/file.entity';

/** Hard cap on extracted text injected into a chat turn (~25k tokens). */
export const MAX_FILE_TEXT_CHARS = 100_000;

export class FileParseError extends Error {
  constructor(
    readonly code: 'file_unreadable' | 'unsupported_file_type',
    message: string,
  ) {
    super(message);
    this.name = 'FileParseError';
  }
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const EXCEL_EXTENSIONS = new Set(['.xlsx', '.xls']);

/**
 * File content extraction for chat attachments.
 *
 * `extractText` is a pure download→parse→cap pipeline with no knowledge
 * of chat; `buildAttachmentContext` adds the chat-facing framing and the
 * UPLOADED→READY/FAILED status transitions. This seam is deliberate:
 * Phase 3 moves extraction to a BullMQ worker by calling `extractText`
 * at upload time and caching its result — chat will then read the cache
 * and this service's chat-facing method becomes a thin lookup.
 */
@Injectable()
export class FileContentService {
  constructor(
    private readonly storage: StorageService,
    @InjectRepository(FileRecord)
    private readonly repo: Repository<FileRecord>,
  ) {}

  /**
   * Downloads the stored object and extracts its text.
   * Throws {@link FileParseError} when the type is unsupported or the
   * document cannot be parsed.
   */
  async extractText(record: FileRecord): Promise<string> {
    const ext = this.extensionOf(record.originalName);

    if (IMAGE_EXTENSIONS.has(ext)) {
      return `An image is attached (${record.originalName}). Its visual content cannot be read as text by this model.`;
    }
    if (!PDF_EXTENSIONS.has(ext) && !EXCEL_EXTENSIONS.has(ext)) {
      throw new FileParseError(
        'unsupported_file_type',
        `No text extractor for "${record.originalName}".`,
      );
    }

    let buffer: Buffer;
    try {
      buffer = await this.storage.getObjectBuffer(record.fileKey);
    } catch (err) {
      throw new FileParseError(
        'file_unreadable',
        err instanceof Error ? err.message : 'Failed to download the file.',
      );
    }

    try {
      const text = PDF_EXTENSIONS.has(ext) ? await this.extractPdf(buffer) : this.extractExcel(buffer);
      if (text.length > MAX_FILE_TEXT_CHARS) {
        return text.slice(0, MAX_FILE_TEXT_CHARS - 11) + '[truncated]';
      }
      return text;
    } catch (err) {
      throw new FileParseError(
        'file_unreadable',
        err instanceof Error ? err.message : 'Failed to parse the document.',
      );
    }
  }

  /**
   * Chat-facing wrapper: framed context block for the model plus the
   * lifecycle status update (READY on success, FAILED on parse failure).
   */
  async buildAttachmentContext(record: FileRecord): Promise<string> {
    try {
      const text = await this.extractText(record);
      await this.repo.save({ ...record, status: FileStatus.READY });
      return (
        `[Attached file: ${record.originalName} (${record.mimeType})]\n` +
        `${text}\n` +
        `[/Attached file]\n\n`
      );
    } catch (err) {
      await this.repo.save({ ...record, status: FileStatus.FAILED });
      throw err;
    }
  }

  private async extractPdf(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      return result.text.trim();
    } finally {
      await parser.destroy();
    }
  }

  private extractExcel(buffer: Buffer): string {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const parts: string[] = [];
    for (const name of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
      parts.push(`### Sheet: ${name}\n${csv}`);
    }
    return parts.join('\n\n').trim();
  }

  private extensionOf(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot).toLowerCase() : '';
  }
}
