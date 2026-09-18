import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UsageService } from './usage.service';
import { AdminUsageQueryDto } from './dto/admin-usage-query.dto';

const DEFAULT_LIMIT = 20;

@Controller('v1/admin/usage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class UsageAdminController {
  constructor(private readonly usage: UsageService) {}

  @Get()
  async list(@Query() query: AdminUsageQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const result = await this.usage.listForAdmin({
      userId: query.userId,
      modelId: query.modelId,
      providerId: query.providerId,
      status: query.status,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      limit,
      offset,
    });

    return {
      items: result.items.map((r) => ({
        id: r.id,
        userId: r.userId,
        conversationId: r.conversationId,
        messageId: r.messageId,
        modelId: r.modelId,
        modelName: r.model?.displayName ?? null,
        providerId: r.providerId,
        providerName: r.provider?.name ?? null,
        promptTokens: r.promptTokens,
        completionTokens: r.completionTokens,
        totalTokens: r.totalTokens,
        estimatedCost: Number(r.estimatedCost),
        attempts: r.attempts ?? 1,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
      total: result.total,
      totals: result.totals,
    };
  }
}
