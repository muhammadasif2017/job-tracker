import { ExecutionContext, Injectable, CanActivate } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator.js';

/**
 * Global guard enforcing `@Roles()`. Runs after `JwtAuthGuard` (see
 * `main.ts`). A route with no required roles is open to any authenticated
 * user; this is what keeps non-admins out of the admin module (ADR-023).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  /** Allows the request when no roles are required or the user holds one of them. */
  canActivate(context: ExecutionContext) {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    return !!user && requiredRoles.includes(user.role);
  }
}
