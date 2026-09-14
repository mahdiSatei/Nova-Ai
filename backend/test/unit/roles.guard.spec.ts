import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../src/common/guards/roles.guard';
import { Roles } from '../../src/common/decorators/roles.decorator';

/**
 * Helpers to build ExecutionContexts that match what NestJS passes to
 * canActivate(). The Reflector is faked to return whatever role-metadata
 * the @Roles decorator would set on the handler.
 */
function ctxWithUser(user: { id: string; role: 'user' | 'admin' } | undefined) {
  const headers = { getRequest: () => ({ user }) };
  return {
    switchToHttp: () => headers,
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeReflector(returned: Array<'user' | 'admin'> | undefined): Reflector {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(returned),
  } as unknown as Reflector;
}

describe('RolesGuard', () => {
  it('passes when there are no @Roles requirements', () => {
    const guard = new RolesGuard(makeReflector(undefined));
    expect(guard.canActivate(ctxWithUser({ id: 'u1', role: 'user' }))).toBe(true);
  });

  it('passes when the user has one of the required roles', () => {
    const guard = new RolesGuard(makeReflector(['admin']));
    expect(guard.canActivate(ctxWithUser({ id: 'u1', role: 'admin' }))).toBe(true);
  });

  it('throws ForbiddenException when a regular user hits an admin-only route', () => {
    const guard = new RolesGuard(makeReflector(['admin']));
    expect(() => guard.canActivate(ctxWithUser({ id: 'u1', role: 'user' }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when there is no user on the request', () => {
    const guard = new RolesGuard(makeReflector(['admin']));
    // When JwtAuthGuard has rejected (no token) the request never reaches
    // RolesGuard in practice. This branch is a defense-in-depth for tests
    // that bypass the JWT guard.
    expect(() => guard.canActivate(ctxWithUser(undefined))).toThrow(ForbiddenException);
  });

  it('passes when the user has any one of multiple acceptable roles', () => {
    const guard = new RolesGuard(makeReflector(['admin', 'user']));
    expect(guard.canActivate(ctxWithUser({ id: 'u1', role: 'user' }))).toBe(true);
    expect(guard.canActivate(ctxWithUser({ id: 'u2', role: 'admin' }))).toBe(true);
  });

  // Verify the @Roles decorator itself so we don't ship a spec that
  // passes for the wrong reason (decorator returning nothing).
  it('@Roles writes metadata onto the handler', () => {
    @Roles('admin')
    class Handler {}

    const meta = Reflect.getMetadata('roles', Handler);
    expect(meta).toEqual(['admin']);
  });
});
