import * as Sentry from '@sentry/nextjs';

/**
 * Server- and edge-side Sentry (ADR-051). Next.js calls `register` once per
 * runtime; each config file starts Sentry only when a DSN is set.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/** Reports errors thrown while rendering or handling a request on the server. */
export const onRequestError = Sentry.captureRequestError;
