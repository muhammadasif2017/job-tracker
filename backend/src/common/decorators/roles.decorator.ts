import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

/** Metadata key `RolesGuard` reads. */
export const ROLES_KEY = 'roles';
/** Restricts a route, or a whole controller, to users holding one of `roles`. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
