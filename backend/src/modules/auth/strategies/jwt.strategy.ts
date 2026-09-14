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

/**
 * Shape attached to `request.user` after a successful JWT verification.
 * `exp` is the unix-second expiry of the access token — used by
 * logout to know how long to keep the jti on the revocation list.
 */
export interface AuthenticatedRequestUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  jti: string;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt.secret', { infer: true }),
    });
  }

  validate(payload: JwtPayload): AuthenticatedRequestUser {
    gcRevoked();
    if (isRevoked(payload.jti)) {
      throw new UnauthorizedException('invalid_token');
    }
    return {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      jti: payload.jti,
      exp: payload.exp,
    };
  }
}
