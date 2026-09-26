import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Gauge } from '@prometheus-io/client';
import type { CircuitState } from '../../infrastructure/resilience/circuit-breaker.js';
import { MetricsService } from '../../infrastructure/metrics/metrics.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from '../timeline-summary/timeline-summary.constants.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor.js';
import { LlmService } from '../enrichment/services/llm.service.js';
import { COUNTED_STATES } from './admin-queues.constants.js';
import { readQueueCounts, type QueueCounts } from './queue-counts.helper.js';
import { logRedisFailure } from '../../infrastructure/redis/redis-errors.helper.js';

/** Gauge value per circuit state; the help text states the same mapping. */
const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = {
  closed: 0,
  'half-open': 1,
  open: 2,
};

/**
 * Exposes the queue and circuit-breaker state the admin queues page shows
 * (`AdminQueuesService`) as Prometheus gauges (ADR-052), read at scrape time
 * so there is no polling loop.
 *
 * The Postgres half of that page (company status buckets) is left out: a
 * scrape every 60 s should not cost a `groupBy` over every company.
 */
@Injectable()
export class QueueMetricsService implements OnModuleInit {
  private readonly logger = new Logger(QueueMetricsService.name);

  private readonly queues: ReadonlyArray<readonly [string, Queue]>;
  /** The counts one scrape is reading, shared by both queue gauges. */
  private inFlight: Promise<Map<string, QueueCounts | null>> | null = null;

  constructor(
    private readonly metrics: MetricsService,
    @InjectQueue(COMPANY_ENRICHMENT_QUEUE) enrichmentQueue: Queue,
    @InjectQueue(JOB_TIMELINE_SUMMARY_QUEUE) timelineSummaryQueue: Queue,
    @InjectQueue(NOTIFICATIONS_QUEUE) notificationsQueue: Queue,
    private readonly llm: LlmService,
  ) {
    this.queues = [
      [COMPANY_ENRICHMENT_QUEUE, enrichmentQueue],
      [JOB_TIMELINE_SUMMARY_QUEUE, timelineSummaryQueue],
      [NOTIFICATIONS_QUEUE, notificationsQueue],
    ];
  }

  onModuleInit() {
    const registers = [this.metrics.registry];

    const jobs: Gauge<'queue' | 'state'> = new Gauge({
      name: 'jobtracker_queue_jobs',
      help: 'BullMQ jobs per queue and state. A queue whose counts could not be read has no series.',
      labelNames: ['queue', 'state'] as const,
      registers,
      collect: async () => {
        for (const [queue, counts] of await this.readCounts()) {
          for (const state of COUNTED_STATES) {
            if (counts) jobs.set({ queue, state }, counts[state]);
            else jobs.remove({ queue, state });
          }
        }
      },
    });

    const up: Gauge<'queue'> = new Gauge({
      name: 'jobtracker_queue_up',
      help: '1 when the queue counts were read at scrape time, 0 when Redis failed or timed out.',
      labelNames: ['queue'] as const,
      registers,
      collect: async () => {
        for (const [queue, counts] of await this.readCounts()) {
          up.set({ queue }, counts ? 1 : 0);
        }
      },
    });

    const circuit: Gauge<'circuit'> = new Gauge({
      name: 'jobtracker_circuit_state',
      help: 'Circuit breaker state: 0 closed, 1 half-open, 2 open.',
      labelNames: ['circuit'] as const,
      registers,
      collect: () => {
        const status = this.llm.circuitStatus();
        circuit.set(
          { circuit: status.name },
          CIRCUIT_STATE_VALUE[status.state],
        );
      },
    });
  }

  /**
   * Reads all queues once per scrape. The client starts every metric's
   * `collect` in the same tick, so both queue gauges get the same promise
   * and the same numbers, and Redis is asked once, not twice.
   */
  readCounts(): Promise<Map<string, QueueCounts | null>> {
    this.inFlight ??= Promise.all(
      this.queues.map(
        async ([name, queue]) =>
          [name, await this.countOne(name, queue)] as const,
      ),
    )
      .then((entries) => new Map(entries))
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  /**
   * Per queue, so one failing queue does not blank the others. A slow Redis
   * cannot stall the scrape: the queues' connection has a 2 s
   * `commandTimeout` (ADR-046), which lands here as a rejection.
   */
  private async countOne(
    name: string,
    queue: Queue,
  ): Promise<QueueCounts | null> {
    try {
      return await readQueueCounts(queue);
    } catch (error) {
      // Debug during a reported outage (the scrape shows `jobtracker_queue_up
      // 0` anyway); a warning otherwise, e.g. a wrong password.
      logRedisFailure(
        this.logger,
        error,
        { queue: name },
        'Queue counts unavailable for metrics',
      );
      return null;
    }
  }
}
