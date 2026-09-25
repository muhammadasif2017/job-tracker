import * as Sentry from '@sentry/nextjs';

/**
 * Server-side Sentry (ADR-051). Only the Node.js runtime is set up: in
 * Next 16 `proxy.ts` always runs on Node.js, and no route opts into edge.
 * The config file starts Sentry only when a DSN is set.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

/** Reports errors thrown while rendering or handling a request on the server. */
export const onRequestError = Sentry.captureRequestError;
