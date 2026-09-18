import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { QuotaRule } from './entities/quota-rule.entity';
import { CreateQuotaRuleDto, UpdateQuotaRuleDto } from './dto/quota-rule.dto';

/**
 * Admin-only quota policy configuration (spec 005 §Scope — "Admin quota
 * configuration"). Rules are keyed by access tier; new users inherit the
 * rule matching their tier.
 */
@Controller('v1/admin/quota-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class QuotasAdminController {
  constructor(
    @InjectRepository(QuotaRule)
    private readonly repo: Repository<QuotaRule>,
  ) {}

  @Get()
  async list() {
    const rules = await this.repo.find({ order: { tier: 'ASC' } });
    return { items: rules.map((r) => this.toRule(r)) };
  }

  @Post()
  async create(@Body() dto: CreateQuotaRuleDto) {
    const rule = this.repo.create(dto);
    await this.repo.save(rule);
    return this.toRule(rule);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateQuotaRuleDto) {
    const rule = await this.repo.findOne({ where: { id } });
    if (!rule) {
      throw new NotFoundException({
        code: 'quota_rule_not_found',
        message: 'Quota rule not found.',
      });
    }
    if (dto.tokenLimit !== undefined) rule.tokenLimit = dto.tokenLimit;
    if (dto.label !== undefined) rule.label = dto.label;
    await this.repo.save(rule);
    return this.toRule(rule);
  }

  private toRule(rule: QuotaRule) {
    return {
      id: rule.id,
      tier: rule.tier,
      tokenLimit: Number(rule.tokenLimit),
      label: rule.label,
      createdAt: rule.createdAt.toISOString(),
    };
  }
}
