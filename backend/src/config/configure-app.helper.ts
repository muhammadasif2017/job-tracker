import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PatScopeGuard } from '../common/guards/pat-scope.guard.js';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter.js';
import { applyApiVersioning } from './api-versioning.helper.js';
import { MetricsService } from '../infrastructure/metrics/metrics.service.js';
import { httpMetricsMiddleware } from '../infrastructure/metrics/http-metrics.helper.js';
import {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
} from '../common/request-context.helper.js';

/**
 * The request pipeline every instance of the app runs: correlation IDs,
 * request metrics,
 * proxy trust, security headers, cookies, CORS, validation, the global guards, the
 * exception filter and API versioning.
 *
 * `main.ts` and the e2e setup both call this, so the suite tests the same
 * pipeline production serves. Before, the e2e setup copied it by hand, and
 * every new global had to be remembered in two places.
 *
 * Guard order matters: `JwtAuthGuard` resolves `request.user` before
 * `RolesGuard` and `PatScopeGuard` read it.
 */
export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);

  // Caddy fronts the API in production (docker-compose.prod.yml). Without
  // this, Express resolves req.ip to Caddy's container address for every
  // request, so ThrottlerGuard (whose default tracker is req.ip) buckets the
  // entire internet together — the per-IP @Throttle limits on /auth/login and
  // /auth/register would be a single global 10/min instead of 10/min each.
  // Exactly one hop: Caddy appends the real client to X-Forwarded-For, so
  // trusting one proxy makes req.ip that client, while a client-supplied
  // X-Forwarded-For entry sits further left in the list and stays untrusted.
  // Deliberately not enabled outside production, where the app is reached
  // directly and a forged X-Forwarded-For would otherwise become req.ip.
  if (config.get('NODE_ENV') === 'production') {
    app.set('trust proxy', 1);
  }

  // First, so every later middleware, guard, handler and log line runs inside
  // the request's correlation context (ADR-049).
  app.use(requestIdMiddleware);
  // Before the rest, so its timer covers every later middleware and the
  // guards' 401/403/429 responses too (ADR-052).
  app.use(httpMetricsMiddleware(app.get(MetricsService).httpRequestDuration));
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true,
    // A cross-origin response's headers are invisible to JS unless listed
    // here. The CSV export needs both: `Content-Disposition` carries the
    // server-chosen filename, and `X-Export-Truncated` is the only signal
    // that the download hit the row cap — without it the browser silently
    // saves a partial file. `X-Request-Id` lets the client show or report the
    // correlation ID of a failed call. Caddy is a plain reverse proxy in prod
    // (see Caddyfile), so this is the only place CORS is configured.
    exposedHeaders: [
      'Content-Disposition',
      'X-Export-Truncated',
      REQUEST_ID_HEADER,
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const reflector = app.get(Reflector);
  app.useGlobalGuards(
    new JwtAuthGuard(reflector),
    new RolesGuard(reflector),
    new PatScopeGuard(reflector),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  applyApiVersioning(app);
}
