import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService, MINIO_CLIENT } from '../../src/modules/files/storage.service';

describe('StorageService', () => {
  let svc: StorageService;
  let client: {
    bucketExists: jest.Mock;
    makeBucket: jest.Mock;
    putObject: jest.Mock;
    presignedGetObject: jest.Mock;
  };

  beforeEach(async () => {
    client = {
      bucketExists: jest.fn(() => Promise.resolve(false)),
      makeBucket: jest.fn(() => Promise.resolve()),
      putObject: jest.fn(() => Promise.resolve('etag')),
      presignedGetObject: jest.fn(() => Promise.resolve('http://signed-url')),
    };

    const config = {
      get: jest.fn((key: string) => {
        const map: Record<string, unknown> = {
          'storage.bucket': 'chat-files',
          'storage.presignExpirySec': 604800,
        };
        return map[key];
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: config },
        { provide: MINIO_CLIENT, useValue: client },
      ],
    }).compile();

    svc = moduleRef.get(StorageService);
  });

  describe('onModuleInit', () => {
    it('creates the bucket when it does not exist', async () => {
      await svc.onModuleInit();

      expect(client.bucketExists).toHaveBeenCalledWith('chat-files');
      expect(client.makeBucket).toHaveBeenCalledWith('chat-files');
    });

    it('does not recreate an existing bucket', async () => {
      client.bucketExists.mockResolvedValue(true);

      await svc.onModuleInit();

      expect(client.makeBucket).not.toHaveBeenCalled();
    });

    it('degrades gracefully when storage is unreachable so unrelated features still boot', async () => {
      client.bucketExists.mockRejectedValue(new Error('connection refused'));

      await expect(svc.onModuleInit()).resolves.toBeUndefined();
      expect(client.makeBucket).not.toHaveBeenCalled();
    });

    it('reports availability false after a failed bucket check', async () => {
      client.bucketExists.mockRejectedValue(new Error('connection refused'));

      await svc.onModuleInit();

      expect(svc.isAvailable()).toBe(false);
    });

    it('reports availability true when the bucket check succeeds', async () => {
      await svc.onModuleInit();

      expect(svc.isAvailable()).toBe(true);
    });
  });

  describe('uploadFile', () => {
    const baseFile = {
      buffer: Buffer.from('hello'),
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
      size: 5,
    } as Express.Multer.File;

    it('stores the object under a uuid key with the original extension and returns presigned url', async () => {
      const result = await svc.uploadFile(baseFile);

      expect(client.putObject).toHaveBeenCalledTimes(1);
      const [, key, buffer, , meta] = client.putObject.mock.calls[0];
      expect(key).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      expect(buffer).toBe(baseFile.buffer);
      expect(meta).toMatchObject({ 'Content-Type': 'application/pdf' });

      expect(result.fileKey).toBe(key);
      expect(result.url).toBe('http://signed-url');
      expect(client.presignedGetObject).toHaveBeenCalledWith('chat-files', key, 604800);
    });

    it('uses a bare uuid key when the file has no extension', async () => {
      const result = await svc.uploadFile({ ...baseFile, originalname: 'README' });

      const [, key] = client.putObject.mock.calls[0];
      expect(key).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.fileKey).toBe(key);
    });
  });
});
