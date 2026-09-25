import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './configure-app.helper.js';
import { requestIdMiddleware } from '../common/request-context.helper.js';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import { PatScopeGuard } from '../common/guards/pat-scope.guard.js';
import { GlobalExceptionFilter } from '../common/filters/global-exception.filter.js';
import { MetricsService } from '../infrastructure/metrics/metrics.service.js';

/** A stand-in app that records every configuration call. */
function fakeApp(env: Record<string, string>) {
  const config = { get: jest.fn((key: string) => env[key]) };
  const reflector = new Reflector();
  const metrics = new MetricsService();
  const app = {
    get: jest.fn((token: unknown) => {
      if (token === ConfigService) return config;
      if (token === MetricsService) return metrics;
      return reflector;
    }),
    set: jest.fn(),
    use: jest.fn(),
    enableCors: jest.fn(),
    useGlobalPipes: jest.fn(),
    useGlobalGuards: jest.fn(),
    useGlobalFilters: jest.fn(),
    enableVersioning: jest.fn(),
  };
  return app;
}

function configure(env: Record<string, string>) {
  const app = fakeApp(env);
  configureApp(app as unknown as NestExpressApplication);
  return app;
}

describe('configureApp', () => {
  it('trusts exactly one proxy hop in production only', () => {
    expect(configure({ NODE_ENV: 'production' }).set).toHaveBeenCalledWith(
      'trust proxy',
      1,
    );
    expect(configure({ NODE_ENV: 'test' }).set).not.toHaveBeenCalled();
  });

  it('registers the request-ID middleware first, then metrics, security headers and cookies', () => {
    const app = configure({});

    expect(app.use).toHaveBeenCalledTimes(4);
    expect(app.use.mock.calls[0][0]).toBe(requestIdMiddleware);
    // The metrics middleware is a closure, so it is identified by position.
    expect(app.get).toHaveBeenCalledWith(MetricsService);
  });

  it('allows the frontend origin with credentials and exposes the export headers', () => {
    const app = configure({ FRONTEND_URL: 'https://app.example' });

    expect(app.enableCors).toHaveBeenCalledWith({
      origin: 'https://app.example',
      credentials: true,
      exposedHeaders: [
        'Content-Disposition',
        'X-Export-Truncated',
        'X-Request-Id',
      ],
    });
  });

  it('validates and strips request bodies, rejecting unknown fields', () => {
    const [pipe] = configure({}).useGlobalPipes.mock.calls[0] as [
      ValidationPipe,
    ];

    expect(pipe).toBeInstanceOf(ValidationPipe);
    expect(pipe).toMatchObject({
      validatorOptions: { whitelist: true, forbidNonWhitelisted: true },
      isTransformEnabled: true,
    });
  });

  it('registers the JWT guard before the guards that read request.user', () => {
    const guards = configure({}).useGlobalGuards.mock.calls[0];

    expect(guards[0]).toBeInstanceOf(JwtAuthGuard);
    expect(guards[1]).toBeInstanceOf(RolesGuard);
    expect(guards[2]).toBeInstanceOf(PatScopeGuard);
  });

  it('installs the exception filter and URI versioning', () => {
    const app = configure({});

    expect(app.useGlobalFilters.mock.calls[0][0]).toBeInstanceOf(
      GlobalExceptionFilter,
    );
    expect(app.enableVersioning).toHaveBeenCalledWith(
      expect.objectContaining({ type: VersioningType.URI }),
    );
  });
});
