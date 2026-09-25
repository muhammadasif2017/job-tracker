import {
  CanActivate,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  INestApplication,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { Histogram, Registry } from '@prometheus-io/client';
import request from 'supertest';
import { applyApiVersioning } from '../../config/api-versioning.helper.js';
import {
  httpMetricsMiddleware,
  routeLabel,
  statusClass,
} from './http-metrics.helper.js';

/** Always refuses, the way a global guard refuses before any interceptor. */
@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    throw new ForbiddenException();
  }
}

/** Two routes: one with a path parameter, one refused by a guard. */
@Controller('things')
class ThingsController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return { id };
  }

  @Get('secret/area')
  @UseGuards(DenyGuard)
  secret() {
    return {};
  }
}

describe('routeLabel', () => {
  it('joins the router base and the matched route template', () => {
    const req = { baseUrl: '/api', route: { path: '/jobs/:id' } };

    expect(routeLabel(req as unknown as Request)).toBe('/api/jobs/:id');
  });

  it('labels a request that matched no route as unmatched', () => {
    expect(routeLabel({ baseUrl: '' } as unknown as Request)).toBe('unmatched');
  });

  it('labels the logger middleware’s catch-all route as unmatched', () => {
    const req = { baseUrl: '', route: { path: '{/*splat}' } };

    expect(routeLabel(req as unknown as Request)).toBe('unmatched');
  });
});

describe('statusClass', () => {
  it('reduces a status code to its class', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
  });
});

describe('httpMetricsMiddleware', () => {
  let app: INestApplication;
  let histogram: Histogram<'method' | 'route' | 'status_class'>;

  /** The label sets recorded so far, one per observed route and class. */
  async function recorded() {
    const { values } = await histogram.get();
    return values
      .filter((v) => v.metricName === 'http_request_duration_seconds_count')
      .map((v) => ({ ...v.labels, count: v.value }));
  }

  beforeEach(async () => {
    histogram = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'test',
      labelNames: ['method', 'route', 'status_class'] as const,
      registers: [new Registry()],
    });
    const module = await Test.createTestingModule({
      controllers: [ThingsController],
    }).compile();
    app = module.createNestApplication();
    app.use(httpMetricsMiddleware(histogram));
    applyApiVersioning(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('labels a request with its route template, not its URL', async () => {
    await request(app.getHttpServer()).get('/v1/things/abc-123').expect(200);

    expect(await recorded()).toEqual([
      { method: 'GET', route: '/v1/things/:id', status_class: '2xx', count: 1 },
    ]);
  });

  it('keeps the unversioned alias apart from the /v1 route', async () => {
    await request(app.getHttpServer()).get('/things/abc').expect(200);

    expect(await recorded()).toEqual([
      expect.objectContaining({ route: '/things/:id' }),
    ]);
  });

  it('records a response a guard refused, which an interceptor would miss', async () => {
    await request(app.getHttpServer())
      .get('/v1/things/secret/area')
      .expect(403);

    expect(await recorded()).toEqual([
      expect.objectContaining({
        route: '/v1/things/secret/area',
        status_class: '4xx',
      }),
    ]);
  });

  it('labels a 404 for an unknown path as unmatched', async () => {
    await request(app.getHttpServer()).get('/nope/12345').expect(404);

    expect(await recorded()).toEqual([
      expect.objectContaining({ route: 'unmatched', status_class: '4xx' }),
    ]);
  });
});
