import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PDFParse } from 'pdf-parse';
import * as XLSX from 'xlsx';
import {
  FileContentService,
  FileParseError,
  MAX_FILE_TEXT_CHARS,
} from '../../src/modules/files/file-content.service';
import { StorageService } from '../../src/modules/files/storage.service';
import { FileRecord, FileStatus } from '../../src/modules/files/entities/file.entity';

jest.mock('pdf-parse', () => ({ PDFParse: jest.fn() }));
jest.mock('xlsx', () => ({
  read: jest.fn(),
  utils: { sheet_to_csv: jest.fn() },
}));

const pdfParseMock = PDFParse as unknown as jest.Mock;

/** Reconfigures the PDFParse class mock so getText resolves with `text`. */
function mockPdfText(text: string): void {
  pdfParseMock.mockImplementation(() => ({
    getText: jest.fn(async () => ({ text })),
    destroy: jest.fn(async () => undefined),
  }));
}

function mockPdfError(err: Error): void {
  pdfParseMock.mockImplementation(() => ({
    getText: jest.fn(async () => {
      throw err;
    }),
    destroy: jest.fn(async () => undefined),
  }));
}

describe('FileContentService', () => {
  let svc: FileContentService;
  let storage: { getObjectBuffer: jest.Mock };
  let repo: { save: jest.Mock };

  const record = (overrides: Partial<FileRecord> = {}): FileRecord =>
    ({
      id: 'file-1',
      userId: 'user-1',
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      size: 10,
      fileKey: 'k.pdf',
      url: 'http://signed',
      status: FileStatus.UPLOADED,
      createdAt: new Date(),
      ...overrides,
    } as FileRecord);

  beforeEach(async () => {
    jest.clearAllMocks();
    storage = { getObjectBuffer: jest.fn(() => Promise.resolve(Buffer.from('raw'))) };
    repo = { save: jest.fn((e: any) => Promise.resolve(e)) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FileContentService,
        { provide: StorageService, useValue: storage },
        { provide: getRepositoryToken(FileRecord), useValue: repo },
        { provide: ConfigService, useValue: { get: jest.fn() } },
      ],
    }).compile();

    svc = moduleRef.get(FileContentService);
  });

  describe('extractText', () => {
    it('extracts PDF text from the stored object', async () => {
      mockPdfText('Hello PDF');

      const text = await svc.extractText(record());

      expect(storage.getObjectBuffer).toHaveBeenCalledWith('k.pdf');
      expect(pdfParseMock.mock.calls.length).toBe(1);
      expect(text).toBe('Hello PDF');
    });

    it('extracts Excel sheets as CSV text', async () => {
      (XLSX.read as jest.Mock).mockReturnValue({ SheetNames: ['S1', 'S2'], Sheets: {} });
      (XLSX.utils.sheet_to_csv as jest.Mock).mockReturnValue('a,b\n1,2');
      const rec = record({
        originalName: 'table.xlsx',
        fileKey: 'k.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const text = await svc.extractText(rec);

      expect(XLSX.read).toHaveBeenCalledWith(Buffer.from('raw'), { type: 'buffer' });
      expect(text).toContain('a,b\n1,2');
      expect((XLSX.utils.sheet_to_csv as jest.Mock).mock.calls.length).toBe(2);
    });

    it('returns an image note without downloading for image files', async () => {
      const rec = record({ originalName: 'shot.png', fileKey: 'k.png', mimeType: 'image/png' });

      const text = await svc.extractText(rec);

      expect(storage.getObjectBuffer).not.toHaveBeenCalled();
      expect(text).toContain('shot.png');
      expect(text).toContain('image');
    });

    it('rejects unsupported extensions', async () => {
      const rec = record({ originalName: 'note.txt', fileKey: 'k.txt', mimeType: 'text/plain' });

      await expect(svc.extractText(rec)).rejects.toMatchObject({
        code: 'unsupported_file_type',
      });
    });

    it('truncates very long extracted text with a notice', async () => {
      mockPdfText('x'.repeat(MAX_FILE_TEXT_CHARS + 5000));

      const text = await svc.extractText(record());

      expect(text.length).toBe(MAX_FILE_TEXT_CHARS);
      expect(text.endsWith('[truncated]')).toBe(true);
    });

    it('wraps parse failures in FileParseError', async () => {
      mockPdfError(new Error('bad xref'));

      await expect(svc.extractText(record())).rejects.toBeInstanceOf(FileParseError);
    });
  });

  describe('buildAttachmentContext', () => {
    it('returns a labeled context block and marks the file READY', async () => {
      mockPdfText('Hello PDF');

      const context = await svc.buildAttachmentContext(record());

      expect(context).toContain('[Attached file: report.pdf');
      expect(context).toContain('Hello PDF');
      expect(context).toContain('[/Attached file]');
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FileStatus.READY }),
      );
    });

    it('marks the file FAILED and rethrows on parse failure', async () => {
      mockPdfError(new Error('corrupt'));

      await expect(svc.buildAttachmentContext(record())).rejects.toBeInstanceOf(FileParseError);
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: FileStatus.FAILED }),
      );
    });
  });
});
