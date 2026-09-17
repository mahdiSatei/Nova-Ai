import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterRequestDto } from './dto/register.dto';
import { LoginRequestDto } from './dto/login.dto';
import { RefreshRequestDto } from './dto/refresh.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';

@Controller({ path: 'v1/auth' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() body: RegisterRequestDto): Promise<AuthResponseDto> {
    return this.auth.register(body.username, body.email, body.password);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() body: LoginRequestDto): Promise<AuthResponseDto> {
    return this.auth.login(body.identifier, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Body() body: RefreshRequestDto): Promise<AuthResponseDto> {
    return this.auth.refresh(body.refreshToken);
  }

  /**
   * Logout. The caller must be authenticated (JwtAuthGuard) so we can
   * access the access-token jti. We capture the access token's expiry
   * via a small helper because Passport's verify step leaves the
   * decoded payload on `request.user`.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: AuthenticatedUser | undefined): Promise<void> {
    if (!user) return; // guard ensures this never happens
    const expMs = (user.exp ?? Math.floor(Date.now() / 1000) + 15 * 60) * 1000;
    await this.auth.logout(user.jti, new Date(expMs));
  }
}
