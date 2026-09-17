import { SetMetadata } from '@nestjs/common';

/** Metadata key `JwtAuthGuard` reads. */
export const IS_PUBLIC_KEY = 'isPublic';
/** Exempts a route, or a whole controller, from the global `JwtAuthGuard`. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
