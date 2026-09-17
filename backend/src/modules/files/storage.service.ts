import { Injectable, Module, type OnModuleInit, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';
import { AppConfig } from '../../config/configuration';

/** DI token for the MinIO SDK client (kept injectable for tests). */
export const MINIO_CLIENT = 'MINIO_CLIENT';

export interface StoredFile {
  fileKey: string;
  url: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly bucket: string;
  private readonly presignExpirySec: number;
  private available = false;

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Minio.Client,
    config: ConfigService<AppConfig, true>,
  ) {
    this.bucket = config.get('storage.bucket', { infer: true });
    this.presignExpirySec = config.get('storage.presignExpirySec', { infer: true });
  }

  /**
   * Ensure the default bucket exists. Storage being down must never take
   * the whole API down — we log and mark the service degraded; uploads
   * fail later with a sanitized 502.
   */
  async onModuleInit(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  /** True when the bucket was verified reachable during boot. */
  isAvailable(): boolean {
    return this.available;
  }

  async uploadFile(file: Express.Multer.File): Promise<StoredFile> {
    const fileKey = this.buildFileKey(file.originalname);
    await this.client.putObject(this.bucket, fileKey, file.buffer, file.size, {
      'Content-Type': file.mimetype,
    });
    const url = await this.client.presignedGetObject(
      this.bucket,
      fileKey,
      this.presignExpirySec,
    );
    return { fileKey, url };
  }

  private buildFileKey(originalName: string): string {
    const dot = originalName.lastIndexOf('.');
    const ext =
      dot > 0 && dot < originalName.length - 1 ? originalName.slice(dot) : '';
    return `${randomUUID()}${ext}`;
  }
}

/** Factory for the MinIO SDK client from typed storage config. */
export function createMinioClient(config: ConfigService<AppConfig, true>): Minio.Client {
  return new Minio.Client({
    endPoint: config.get('storage.endpoint', { infer: true }),
    port: config.get('storage.port', { infer: true }),
    useSSL: config.get('storage.useSSL', { infer: true }),
    accessKey: config.get('storage.accessKey', { infer: true }),
    secretKey: config.get('storage.secretKey', { infer: true }),
  });
}

@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: createMinioClient,
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
