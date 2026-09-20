import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService, AuditQueryFilters } from './audit.service';
import type { AuditAction } from './entities/audit-log.entity';

/**
 * Admin-only audit log query endpoint.
 *
 * GET /v1/admin/audit — list audit events with filtering by action,
 * actor, target, and date range.
 */
@Controller('v1/admin/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AuditLogController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query('action') action?: AuditAction,
    @Query('actorId') actorId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const filters: AuditQueryFilters = {
      action,
      actorId,
      targetType,
      targetId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    };

    return this.audit.query(filters);
  }
}
