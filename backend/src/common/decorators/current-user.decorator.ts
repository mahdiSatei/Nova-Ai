import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  jti: string;
  exp?: number;
}

/**
 * Resolve the authenticated user attached to the request by the JWT
 * strategy. Returns `undefined` when the route is `@Public()`.
 */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedUser | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    return request.user;
  },
);
