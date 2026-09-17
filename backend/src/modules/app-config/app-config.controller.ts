import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AppConfigService } from './app-config.service';
import { AppConfigUpdateDto } from './dto/app-config-update.dto';

@Controller('v1/admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AppConfigController {
  constructor(private readonly config: AppConfigService) {}

  @Get()
  read() {
    return this.config.read();
  }

  @Put()
  update(@Body() body: AppConfigUpdateDto) {
    return this.config.update({ defaultModelId: body.defaultModelId ?? null });
  }
}
