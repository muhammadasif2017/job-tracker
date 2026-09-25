import * as Sentry from '@sentry/nextjs';
import { SENTRY_DSN, sharedSentryOptions } from './lib/sentry-options';

/**
 * Edge-runtime Sentry (`proxy.ts`), loaded by `instrumentation.ts`
 * (ADR-051).
 */
if (SENTRY_DSN) {
  Sentry.init(sharedSentryOptions());
}
