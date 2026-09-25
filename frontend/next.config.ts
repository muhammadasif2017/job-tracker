import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs/config';
import { SENTRY_TUNNEL_ROUTE } from './lib/sentry-options';

const nextConfig: NextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for a slim Docker
  // image — that is what frontend/Dockerfile.prod copies out.
  //
  // Not on Vercel, though. Vercel runs its own `onBuildComplete` step that
  // reads `.next/next-server.js.nft.json`, and as of next 16.3.x a standalone
  // build no longer writes that file, so the deploy dies with:
  //   Error: ENOENT: no such file or directory, open
  //   '/vercel/path0/frontend/.next/next-server.js.nft.json'
  // Vercel does its own tracing and packaging, so standalone buys nothing
  // there anyway. `VERCEL` is set on every Vercel build.
  output: process.env.VERCEL ? undefined : 'standalone',
};

/**
 * Sentry's build step (ADR-051). It uploads source maps so a production stack
 * trace points at the real source, then deletes the maps so they are never
 * served. The upload runs only when `SENTRY_AUTH_TOKEN` is set, which is on
 * Vercel only; local and CI builds skip it. The release is detected from
 * Vercel's commit SHA.
 */
export default withSentryConfig(nextConfig, {
  org: 'job-tracker-os',
  project: 'job-tracker-frontend',
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  // Events go to our own origin and are forwarded from there, so ad blockers
  // that block sentry.io do not drop them. proxy.ts excludes this path, or its
  // sign-in redirect would swallow events from signed-out pages.
  tunnelRoute: SENTRY_TUNNEL_ROUTE,
  // That hook only feeds tracing, which is off.
  suppressOnRouterTransitionStartWarning: true,
});
