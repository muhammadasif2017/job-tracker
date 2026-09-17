import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Injects `request.user`: whatever the route's Passport strategy resolved,
 * which for the global `jwt` strategy is the user row plus any token scope.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
