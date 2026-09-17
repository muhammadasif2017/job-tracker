import {
  ExecutionContext,
  Injectable,
  CanActivate,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PAT_ACCESSIBLE_KEY } from '../decorators/pat-accessible.decorator.js';
import { PAT_SCOPE } from '../../modules/tokens/tokens.constants.js';

/**
 * Global guard confining scoped access tokens — those exchanged from a
 * personal access token — to routes marked `@PatAccessible()`. Runs after
 * `JwtAuthGuard` (see `main.ts`), which forwards any `scope` claim for this
 * guard to judge.
 */
@Injectable()
export class PatScopeGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /**
   * Passes unscoped tokens and anonymous requests. A scoped token passes only
   * when its scope is exactly `PAT_SCOPE` and the route opts in, for the
   * fail-closed reason given below.
   */
  canActivate(context: ExecutionContext) {
    const { user } = context.switchToHttp().getRequest();
    // No scope claim = a normal login/refresh-derived token - full access,
    // unaffected by this guard. Fail-closed on *any* scope value other than
    // exactly PAT_SCOPE, not just a missing one - a future restricted scope
    // that's added without updating this guard stays locked out by default
    // instead of silently riding through @PatAccessible() routes meant only
    // for personal access tokens.
    if (!user || !user.scope) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      PAT_ACCESSIBLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!allowed || user.scope !== PAT_SCOPE) {
      throw new ForbiddenException(
        'This access token cannot be used for this endpoint',
      );
    }
    return true;
  }
}
