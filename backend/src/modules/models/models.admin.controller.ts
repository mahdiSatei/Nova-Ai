import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

/**
 * Admin-only routes for the models catalog. US5 establishes the role
 * boundary by mounting a single placeholder route that is protected by
 * both `JwtAuthGuard` and `RolesGuard` with `@Roles('admin')`. US7 / US8
 * add the real CRUD endpoints (`POST`, `PATCH`, `DELETE`) behind the
 * same guard pair.
 *
 * The placeholder exists so that US5 is independently testable: a
 * regular user receives 403, an anonymous request receives 401, and an
 * admin receives 200 — without needing US6 / US7 / US8 to be complete.
 */
@Controller('v1/admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ModelsAdminController {
  @Get()
  list(): { ok: true; note: string } {
    return {
      ok: true,
      note: 'Admin route is reachable. Full CRUD is delivered by US7 / US8 (T009).',
    };
  }
}
