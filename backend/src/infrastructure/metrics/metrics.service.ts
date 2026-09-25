import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';
import { HTTP_DURATION_BUCKETS } from './metrics.constants.js';

/**
 * Owns this process's Prometheus registry (ADR-052): Node's default process
 * metrics plus the HTTP request histogram. Feature modules register their own
 * gauges on `registry` (see `QueueMetricsService`).
 *
 * A registry per instance, not prom-client's global one: the e2e setup
 * builds several apps in one process, and a second registration of the same
 * metric name on the global registry throws.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  /**
   * Request duration by method, route template and status class. The route
   * is the template (`/v1/jobs/:id`), never the raw URL, and the status is
   * its class (`4xx`), so the series count stays bounded.
   */
  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method, route template and status class.',
    labelNames: ['method', 'route', 'status_class'] as const,
    buckets: HTTP_DURATION_BUCKETS,
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
