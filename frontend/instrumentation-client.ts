import {
  breadcrumbsIntegration,
  browserApiErrorsIntegration,
  dedupeIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
} from '@sentry/browser';
import {
  SENTRY_DSN,
  sharedSentryOptions,
  tunnelFor,
  withoutNavigationQuery,
} from './lib/sentry-options';

/**
 * Browser-side Sentry (ADR-051). Next.js runs this file before the app's own
 * client code. It starts only when `NEXT_PUBLIC_SENTRY_DSN` is set.
 *
 * It uses the lean `@sentry/browser` core, not `@sentry/nextjs`, whose browser
 * `init` statically imports tracing and its other default integrations, and
 * Turbopack cannot tree-shake them away even with tracing off. Only error
 * capture is loaded here: uncaught errors and rejections, linked causes, and
 * de-duplication. That adds about 36 KB gzipped to each page's first load.
 * Breadcrumbs record clicks and navigation only. Fetch and XHR crumbs are
 * off, since their URLs can carry search terms, and console crumbs are off
 * because the console integration is not added.
 *
 * `@sentry/nextjs` still runs the server runtime and the build (source maps,
 * release, the tunnel rewrite). Its build step inlines the release as
 * `process.env._sentryRelease`; only its own init reads that, so it is passed
 * here by hand. The tunnel URL is built the same way, by `tunnelFor`.
 */
if (SENTRY_DSN) {
  init({
    ...sharedSentryOptions(),
    release: process.env._sentryRelease || undefined,
    tunnel: tunnelFor(SENTRY_DSN),
    beforeBreadcrumb: withoutNavigationQuery,
    defaultIntegrations: false,
    integrations: [
      functionToStringIntegration(),
      browserApiErrorsIntegration(),
      breadcrumbsIntegration({
        dom: true,
        fetch: false,
        history: true,
        sentry: false,
        xhr: false,
      }),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
    ],
  });
}
