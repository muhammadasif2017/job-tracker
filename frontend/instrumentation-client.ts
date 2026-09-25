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
  SENTRY_TUNNEL_ROUTE,
  sharedSentryOptions,
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
 * `@sentry/nextjs` still runs the server and edge runtimes and the build
 * (source maps, release, the tunnel route). Its build step injects the
 * release that this SDK picks up.
 */
if (SENTRY_DSN) {
  init({
    ...sharedSentryOptions(),
    tunnel: SENTRY_TUNNEL_ROUTE,
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
