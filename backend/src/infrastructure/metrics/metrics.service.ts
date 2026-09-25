import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Histogram,
  Registry,
} from '@prometheus-io/client';
import { HTTP_DURATION_BUCKETS } from './metrics.constants.js';

/**
 * Owns this process's Prometheus registry (ADR-052): the HTTP request
 * histogram, plus Node's process metrics once `collectProcessMetrics` runs.
 * Feature modules register their own gauges on `registry` (see
 * `QueueMetricsService`).
 *
 * A registry per instance, not the client library's global one: the e2e setup
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

  /**
   * Starts Node's default process metrics: CPU, memory, heap, GC and
   * event-loop lag. Called from `main.ts` only when `METRICS_PORT` is set.
   * They install a GC observer and an event-loop monitor that nothing stops,
   * so local runs and the test suites, which never read them, skip it.
   */
  collectProcessMetrics() {
    collectDefaultMetrics({ register: this.registry });
  }
}
