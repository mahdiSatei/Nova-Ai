import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { SharingService } from './sharing.service';

/**
 * Public (unauthenticated) endpoint for reading shared conversation snapshots.
 *
 * GET /v1/shared/:shareId — returns the frozen snapshot content.
 * No auth required; the shareId is the only access control.
 */
@Controller('v1/shared')
export class SharingPublicController {
  constructor(private readonly sharing: SharingService) {}

  @Public()
  @Get(':shareId')
  async getShared(@Param('shareId') shareId: string) {
    const snapshot = await this.sharing.findByShareId(shareId);

    return {
      title: snapshot.title,
      modelDisplayName: snapshot.modelDisplayName,
      createdAt: snapshot.createdAt.toISOString(),
      messages: snapshot.messages.map((m) => ({
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
        citations: m.citations,
        reasoningSummary: m.reasoningSummary,
        file: m.fileSnapshot,
      })),
    };
  }
}
