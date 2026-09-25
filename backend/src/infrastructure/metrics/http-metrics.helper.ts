import type { NextFunction, Request, Response } from 'express';
import type { Histogram } from '@prometheus-io/client';
import { UNMATCHED_ROUTE } from './metrics.constants.js';

/**
 * The route template a request matched, such as `/v1/jobs/:id`, or
 * `unmatched`. Never the raw URL: IDs in it would give every job its own
 * series. `/v1/...` and its unversioned alias (ADR-047) are separate routes,
 * so they get separate labels, which shows who still calls the old paths.
 *
 * A wildcard template also counts as unmatched. `nestjs-pino` mounts its
 * logging middleware on the route `{/*splat}`, so a request no controller
 * handled still leaves that as `req.route`. No controller here uses a
 * wildcard.
 */
export function routeLabel(req: Request): string {
  const path = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof path !== 'string' || path.includes('*')) return UNMATCHED_ROUTE;
  return `${req.baseUrl}${path}`;
}

/** `404` becomes `4xx`: exact codes would multiply the series for little gain. */
export function statusClass(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/**
 * Times every request into `histogram`. Express middleware rather than a Nest
 * interceptor, because guards run before interceptors: an interceptor never
 * sees the 401, 403 and 429 responses the guards send. Recorded on `finish`,
 * so a request the client aborted before the response was sent is not
 * counted.
 */
export function httpMetricsMiddleware(
  histogram: Histogram<'method' | 'route' | 'status_class'>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const end = histogram.startTimer();
    res.on('finish', () => {
      end({
        method: req.method,
        route: routeLabel(req),
        status_class: statusClass(res.statusCode),
      });
    });
    next();
  };
}
