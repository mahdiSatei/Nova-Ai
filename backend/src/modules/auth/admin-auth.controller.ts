import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginRequestDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Admin-only login route. Mounted at `/v1/admin/auth/login` per the
 * OpenAPI contract (admin tag, distinct path from the user-facing
 * `/v1/auth/login`).
 */
@Controller({ path: 'v1/admin/auth' })
export class AdminAuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginRequestDto): Promise<AuthResponseDto> {
    return this.auth.loginAsAdmin(body.identifier, body.password);
  }
}
