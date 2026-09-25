import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger } from 'nestjs-pino';
import { QueueMetricsService } from './queue-metrics.service.js';
import { MetricsService } from '../../infrastructure/metrics/metrics.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from '../timeline-summary/timeline-summary.constants.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor.js';
import { LlmService } from '../enrichment/services/llm.service.js';
import type { CircuitStatus } from '../../infrastructure/resilience/circuit-breaker.js';

const mockEnrichmentQueue = { getJobCounts: jest.fn() };
const mockTimelineQueue = { getJobCounts: jest.fn() };
const mockNotificationsQueue = { getJobCounts: jest.fn() };
const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };
const mockLlm = {
  circuitStatus: jest.fn(
    (): CircuitStatus => ({
      name: 'Groq',
      state: 'closed',
      retryAfterMs: null,
    }),
  ),
};

function counts(overrides: Record<string, number> = {}) {
  return {
    waiting: 0,
    active: 0,
    delayed: 0,
    failed: 0,
    completed: 0,
    ...overrides,
  };
}

describe('QueueMetricsService', () => {
  let metrics: MetricsService;

  /** One scrape, as Alloy would take it. */
  function scrape() {
    return metrics.registry.metrics();
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    mockEnrichmentQueue.getJobCounts.mockResolvedValue(
      counts({ waiting: 3, failed: 1 }),
    );
    mockTimelineQueue.getJobCounts.mockResolvedValue(counts());
    mockNotificationsQueue.getJobCounts.mockResolvedValue(counts());

    const module = await Test.createTestingModule({
      providers: [
        QueueMetricsService,
        MetricsService,
        {
          provide: getQueueToken(COMPANY_ENRICHMENT_QUEUE),
          useValue: mockEnrichmentQueue,
        },
        {
          provide: getQueueToken(JOB_TIMELINE_SUMMARY_QUEUE),
          useValue: mockTimelineQueue,
        },
        {
          provide: getQueueToken(NOTIFICATIONS_QUEUE),
          useValue: mockNotificationsQueue,
        },
        { provide: LlmService, useValue: mockLlm },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    await module.init();
    metrics = module.get(MetricsService);
  });

  it('exports each queue’s job counts by state', async () => {
    const text = await scrape();

    expect(text).toContain(
      `jobtracker_queue_jobs{queue="${COMPANY_ENRICHMENT_QUEUE}",state="waiting"} 3`,
    );
    expect(text).toContain(
      `jobtracker_queue_jobs{queue="${COMPANY_ENRICHMENT_QUEUE}",state="failed"} 1`,
    );
    expect(text).toContain(
      `jobtracker_queue_up{queue="${NOTIFICATIONS_QUEUE}"} 1`,
    );
  });

  it('asks Redis once per queue per scrape, although two gauges read the counts', async () => {
    await scrape();

    expect(mockEnrichmentQueue.getJobCounts).toHaveBeenCalledTimes(1);
    expect(mockTimelineQueue.getJobCounts).toHaveBeenCalledTimes(1);
  });

  it('marks a failing queue down and drops its counts, keeping the others', async () => {
    await scrape();
    mockTimelineQueue.getJobCounts.mockRejectedValue(new Error('ECONNREFUSED'));

    const text = await scrape();

    expect(text).toContain(
      `jobtracker_queue_up{queue="${JOB_TIMELINE_SUMMARY_QUEUE}"} 0`,
    );
    // Removed rather than left at the last good value, which would read as current.
    expect(text).not.toContain(
      `jobtracker_queue_jobs{queue="${JOB_TIMELINE_SUMMARY_QUEUE}"`,
    );
    expect(text).toContain(
      `jobtracker_queue_jobs{queue="${COMPANY_ENRICHMENT_QUEUE}",state="waiting"} 3`,
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ queue: JOB_TIMELINE_SUMMARY_QUEUE }),
      'Queue counts unavailable for metrics',
      QueueMetricsService.name,
    );
  });

  it('reports a queue whose Redis command timed out as down, like any other failure', async () => {
    // The 2 s limit itself is the connection's `commandTimeout` (ADR-046),
    // tested with the Redis connection helper; here it arrives as a rejection.
    mockNotificationsQueue.getJobCounts.mockRejectedValue(
      new Error('Command timed out'),
    );

    const text = await scrape();

    expect(text).toContain(
      `jobtracker_queue_up{queue="${NOTIFICATIONS_QUEUE}"} 0`,
    );
    expect(text).toContain(
      `jobtracker_queue_up{queue="${COMPANY_ENRICHMENT_QUEUE}"} 1`,
    );
  });

  it('exports the circuit state as a number', async () => {
    expect(await scrape()).toContain(
      'jobtracker_circuit_state{circuit="Groq"} 0',
    );

    mockLlm.circuitStatus.mockReturnValueOnce({
      name: 'Groq',
      state: 'open',
      retryAfterMs: 1000,
    });

    expect(await scrape()).toContain(
      'jobtracker_circuit_state{circuit="Groq"} 2',
    );
  });
});
