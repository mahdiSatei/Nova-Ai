import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Delete,
  UseGuards,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ProviderService, ProviderAdmin, ApiKeyPublic } from './provider.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';

@Controller('v1/admin/providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{ items: ProviderAdmin[]; total: number; page: number; pageSize: number }> {
    const p = page ? Math.max(1, parseInt(page, 10)) : 1;
    const ps = pageSize ? Math.min(100, Math.max(1, parseInt(pageSize, 10))) : 20;
    return this.providerService.list(p, ps);
  }

  @Get(':id')
  async read(@Param('id') id: string): Promise<ProviderAdmin> {
    return this.providerService.read(id);
  }

  @Post()
  async create(@Body() body: CreateProviderDto): Promise<ProviderAdmin> {
    return this.providerService.create(body);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateProviderDto): Promise<ProviderAdmin> {
    return this.providerService.update(id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.providerService.delete(id);
  }

  @Post(':id/validate')
  async validate(@Param('id') id: string): Promise<ProviderAdmin> {
    return this.providerService.validateProvider(id);
  }

  // ── API Key Management ──────────────────────────────────────────────

  @Get(':id/api-keys')
  async listApiKeys(@Param('id') id: string): Promise<ApiKeyPublic[]> {
    return this.providerService.listApiKeys(id);
  }

  @Post(':id/api-keys')
  async addApiKey(@Param('id') id: string, @Body() body: CreateApiKeyDto): Promise<ApiKeyPublic> {
    return this.providerService.addApiKey(id, body);
  }

  @Patch(':id/api-keys/:keyId')
  async updateApiKey(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
    @Body() body: UpdateApiKeyDto,
  ): Promise<ApiKeyPublic> {
    return this.providerService.updateApiKey(id, keyId, body);
  }

  @Delete(':id/api-keys/:keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteApiKey(@Param('id') id: string, @Param('keyId') keyId: string): Promise<void> {
    await this.providerService.deleteApiKey(id, keyId);
  }

  @Post(':id/api-keys/:keyId/validate')
  async validateApiKey(
    @Param('id') id: string,
    @Param('keyId') keyId: string,
  ): Promise<ApiKeyPublic> {
    return this.providerService.validateApiKey(id, keyId);
  }
}
