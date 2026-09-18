import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { FilesService } from './files.service';
import { FileRecord } from './entities/file.entity';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.xls', '.png', '.jpg', '.jpeg']);
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
/** Memory backstop above the product limit; rejected files are caught in the handler. */
const MULTER_HARD_LIMIT_BYTES = 25 * 1024 * 1024;

/**
 * Authenticated file upload endpoint for chat attachments.
 *
 * Accepts PDF, Excel (xlsx/xls) and images (png/jpg/jpeg) up to 10MB,
 * stores the object in MinIO and persists file metadata.
 */
@Controller('v1/files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MULTER_HARD_LIMIT_BYTES },
      fileFilter: (_req, file, cb) => {
        const dot = file.originalname.lastIndexOf('.');
        const ext = dot > 0 ? file.originalname.slice(dot).toLowerCase() : '';
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          cb(
            new BadRequestException({
              code: 'invalid_file_type',
              message:
                'Only PDF, Excel (xlsx, xls) and image (png, jpg, jpeg) files are allowed.',
            }),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    fileKey: string;
    url: string;
    status: string;
    createdAt: string;
  }> {
    if (!file) {
      throw new BadRequestException({
        code: 'no_file',
        message: 'No file was provided in the "file" field.',
      });
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new PayloadTooLargeException({
        code: 'file_too_large',
        message: 'File exceeds the 10MB size limit.',
      });
    }

    // رفع باگ کاراکترهای فارسی در نام فایل
    try {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      /* ignore */
    }

    const record = await this.files.create(file, user.id);
    return FilesController.toPublic(record);
  }

  @Get(':id/status')
  async getStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{
    id: string;
    originalName: string;
    status: string;
    errorMessage: string | null;
  }> {
    const record = await this.files.findOwned(id, user.id);
    if (!record) {
      throw new NotFoundException({
        code: 'file_not_found',
        message: 'File was not found.',
      });
    }

    return {
      id: record.id,
      originalName: record.originalName,
      status: record.status,
      errorMessage: record.errorMessage ?? null,
    };
  }

  static toPublic(record: FileRecord): {
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
    fileKey: string;
    url: string;
    status: string;
    createdAt: string;
  } {
    return {
      id: record.id,
      originalName: record.originalName,
      mimeType: record.mimeType,
      size: record.size,
      fileKey: record.fileKey,
      url: record.url,
      status: record.status,
      createdAt: record.createdAt.toISOString(),
    };
  }
}