import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadGatewayException } from '@nestjs/common';
import { FilesService } from '../../src/modules/files/files.service';
import { StorageService } from '../../src/modules/files/storage.service';
import { FileRecord, FileStatus } from '../../src/modules/files/entities/file.entity';
import { User } from '../../src/modules/users/entities/user.entity';
import { Queue } from 'bullmq';

describe('FilesService', () => {
  let svc: FilesService;
  let storage: { uploadFile: jest.Mock };
  let repo: { create: jest.Mock; save: jest.Mock; findOne: jest.Mock };

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
      findOne: jest.fn((opts: any) => {
        const all = [
          { id: 'file-1', userId: 'user-42', fileKey: 'k', status: FileStatus.UPLOADED },
          { id: 'file-2', userId: 'someone-else', fileKey: 'k2', status: FileStatus.UPLOADED },
        ];
        const hit = all.find(
          (r) => r.id === opts?.where?.id && r.userId === opts?.where?.userId,
        );
        return Promise.resolve(hit ?? null);
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: StorageService, useValue: storage },
        { provide: getRepositoryToken(FileRecord), useValue: repo },
        { provide: getRepositoryToken(User), useValue: { findByIds: jest.fn(async () => []) } },
        { provide: Queue, useValue: { add: jest.fn(async () => ({})) } },
      ],
    }).compile();

    svc = moduleRef.get(FilesService);
  });

  it('uploads to storage then persists a record with status UPLOADED', async () => {
    const result = await svc.create(file, 'user-42');

    expect(storage.uploadFile).toHaveBeenCalledWith(file);
    expect(repo.create).toHaveBeenCalledWith({
      userId: 'user-42',
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

  it('finds an owned file by id and owner', async () => {
    repo.findOne = jest.fn(() =>
      Promise.resolve({ id: 'file-1', userId: 'user-42', fileKey: 'k', status: FileStatus.UPLOADED }),
    );
    const record = await svc.findOwned('file-1', 'user-42');
    expect(record?.id).toBe('file-1');
  });

  it('returns null when the file belongs to someone else', async () => {
    expect(await svc.findOwned('file-2', 'user-42')).toBeNull();
  });

  it('returns null when the file does not exist', async () => {
    expect(await svc.findOwned('missing', 'user-42')).toBeNull();
  });

  it('wraps storage failures in a sanitized BadGatewayException', async () => {
    storage.uploadFile.mockRejectedValue(new Error('MinIO connection refused'));

    await expect(svc.create(file, 'user-42')).rejects.toThrow(BadGatewayException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('does not save a record when storage upload fails', async () => {
    storage.uploadFile.mockRejectedValue(new Error('boom'));

    await expect(svc.create(file, 'user-42')).rejects.toThrow();
    expect(repo.create).not.toHaveBeenCalled();
  });
});
