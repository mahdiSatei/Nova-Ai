import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadGatewayException } from '@nestjs/common';
import { FilesService } from '../../src/modules/files/files.service';
import { StorageService } from '../../src/modules/files/storage.service';
import { FileRecord, FileStatus } from '../../src/modules/files/entities/file.entity';

describe('FilesService', () => {
  let svc: FilesService;
  let storage: { uploadFile: jest.Mock };
  let repo: { create: jest.Mock; save: jest.Mock };

  const file = {
    buffer: Buffer.from('x'),
    originalname: 'data.xlsx',
    mimetype:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1234,
  } as Express.Multer.File;

  beforeEach(async () => {
    storage = {
      uploadFile: jest.fn(() =>
        Promise.resolve({ fileKey: 'uuid-1.xlsx', url: 'http://signed' }),
      ),
    };
    const saved: any[] = [];
    repo = {
      create: jest.fn((dto: any) => ({ ...dto, id: 'file-1', createdAt: new Date() })),
      save: jest.fn((entity: any) => {
        saved.push(entity);
        return Promise.resolve(entity);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: StorageService, useValue: storage },
        { provide: getRepositoryToken(FileRecord), useValue: repo },
      ],
    }).compile();

    svc = moduleRef.get(FilesService);
  });

  it('uploads to storage then persists a record with status UPLOADED', async () => {
    const result = await svc.create(file);

    expect(storage.uploadFile).toHaveBeenCalledWith(file);
    expect(repo.create).toHaveBeenCalledWith({
      originalName: 'data.xlsx',
      mimeType: file.mimetype,
      size: 1234,
      fileKey: 'uuid-1.xlsx',
      url: 'http://signed',
      status: FileStatus.UPLOADED,
    });
    expect(result.id).toBe('file-1');
    expect(result.fileKey).toBe('uuid-1.xlsx');
    expect(result.url).toBe('http://signed');
    expect(result.status).toBe(FileStatus.UPLOADED);
  });

  it('wraps storage failures in a sanitized BadGatewayException', async () => {
    storage.uploadFile.mockRejectedValue(new Error('MinIO connection refused'));

    await expect(svc.create(file)).rejects.toThrow(BadGatewayException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('does not save a record when storage upload fails', async () => {
    storage.uploadFile.mockRejectedValue(new Error('boom'));

    await expect(svc.create(file)).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
