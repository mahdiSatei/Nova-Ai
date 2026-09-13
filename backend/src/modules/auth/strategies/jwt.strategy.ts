import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AppConfig } from '../../../config/configuration';
import { gcRevoked, isRevoked } from './revocation-list';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'user' | 'admin';
  jti: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.secret', { infer: true }) as string,
    });
  }

  /**
   * Passport invokes this after the token signature and expiry are
   * verified. We additionally reject any jti present in the
   * revocation list (logout).
   */
  validate(payload: JwtPayload): JwtPayload {
    gcRevoked();
    if (isRevoked(payload.jti)) {
      throw new UnauthorizedException('invalid_token');
    }
    return payload;
  }
}
