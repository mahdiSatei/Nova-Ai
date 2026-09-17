import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProviderService } from './provider.service';
import { CentralProviderUpdateDto } from './dto/central-provider-update.dto';

/**
 * Admin-only endpoints for the central provider singleton. Both
 * endpoints require an admin JWT (JwtAuthGuard) plus the `admin` role
 * (RolesGuard). The full CRUD for the models catalog lives in the
 * models.admin.controller; this controller is dedicated to provider
 * configuration.
 */
@Controller('v1/admin/provider')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ProviderController {
  constructor(private readonly provider: ProviderService) {}

  @Get()
  async read() {
    return this.provider.read();
  }

  @Put()
  update(@Body() body: CentralProviderUpdateDto) {
    return this.provider.update(body);
  }
}
