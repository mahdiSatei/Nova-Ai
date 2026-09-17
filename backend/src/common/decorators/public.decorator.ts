import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route as not requiring authentication. Used by the global
 * JwtAuthGuard to allow register/login/refresh/health endpoints to
 * pass through without a token.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_KEY, true);
