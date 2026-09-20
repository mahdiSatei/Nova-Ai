import {
  Controller,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { SharingService } from './sharing.service';

/**
 * Authenticated sharing endpoints.
 *
 * POST /v1/conversations/:id/share — creates an immutable snapshot and
 * returns the public share identifier.
 */
@Controller('v1/conversations')
@UseGuards(JwtAuthGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  /**
   * Create an immutable snapshot of a conversation for sharing.
   *
   * Returns the shareId (used in the public URL /s/:shareId) and basic
   * metadata about the snapshot.
   */
  @Post(':id/share')
  @HttpCode(HttpStatus.CREATED)
  async createShare(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const snapshot = await this.sharing.createSnapshot(user.id, id);

    return {
      shareId: snapshot.shareId,
      title: snapshot.title,
      modelDisplayName: snapshot.modelDisplayName,
      messageCount: snapshot.messages?.length ?? 0,
      createdAt: snapshot.createdAt.toISOString(),
    };
  }
}
