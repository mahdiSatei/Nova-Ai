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
    
    return this.filesService.findAllAdmin(parsedLimit, parsedOffset, { status, mimeType, userId });
  }
}