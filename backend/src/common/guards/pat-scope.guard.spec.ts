import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PatScopeGuard } from './pat-scope.guard.js';

const mockReflector = { getAllAndOverride: jest.fn() };

function contextWithUser(user: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PatScopeGuard', () => {
  let guard: PatScopeGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new PatScopeGuard(mockReflector as unknown as Reflector);
  });

  it('allows requests with no user (public routes handled upstream)', () => {
    expect(guard.canActivate(contextWithUser(undefined))).toBe(true);
    expect(mockReflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('allows a normal (non-PAT) token through unconditionally', () => {
    expect(guard.canActivate(contextWithUser({ id: 'u-1' }))).toBe(true);
    expect(mockReflector.getAllAndOverride).not.toHaveBeenCalled();
  });

  it('allows a PAT-scoped token on a @PatAccessible() route', () => {
    mockReflector.getAllAndOverride.mockReturnValue(true);
    expect(
      guard.canActivate(contextWithUser({ id: 'u-1', scope: 'pat' })),
    ).toBe(true);
  });

  it('rejects a PAT-scoped token on a route without @PatAccessible()', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(contextWithUser({ id: 'u-1', scope: 'pat' })),
    ).toThrow(ForbiddenException);
  });

  it('fails closed on an unrecognized scope value rather than granting full access', () => {
    mockReflector.getAllAndOverride.mockReturnValue(undefined);
    expect(() =>
      guard.canActivate(contextWithUser({ id: 'u-1', scope: 'some-future-scope' })),
    ).toThrow(ForbiddenException);
  });
});
