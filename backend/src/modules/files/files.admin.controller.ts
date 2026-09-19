import { Controller, Get, UseGuards, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { FilesService } from './files.service';
import { FileStatus } from './entities/file.entity';

@Controller('v1/admin/files')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class FilesAdminController {
  constructor(private readonly filesService: FilesService) {}

  @Get()
  async findAll(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('status') status?: FileStatus,
    @Query('mimeType') mimeType?: string,
    @Query('userId') userId?: string,
  ) {
    const parsedLimit = limit ? Math.min(parseInt(limit, 10), 100) : 20;
    const parsedOffset = offset ? parseInt(offset, 10) : 0;
    
    // نرمال‌سازی نوع فایل برای فیلترینگ آسان‌تر
    let normalizedMimeType = mimeType;
    if (mimeType) {
      if (mimeType.toLowerCase() === 'jpg' || mimeType.toLowerCase() === 'jpeg') normalizedMimeType = 'image/jpeg';
      else if (mimeType.toLowerCase() === 'png') normalizedMimeType = 'image/png';
      else if (mimeType.toLowerCase() === 'pdf') normalizedMimeType = 'application/pdf';
      else if (mimeType.toLowerCase() === 'xlsx') normalizedMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      else if (mimeType.toLowerCase() === 'xls') normalizedMimeType = 'application/vnd.ms-excel';
    }
    
    return this.filesService.findAllAdmin(parsedLimit, parsedOffset, { status, mimeType: normalizedMimeType, userId });
  }
}