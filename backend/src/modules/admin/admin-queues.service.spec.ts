import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { AdminQueuesService } from './admin-queues.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from '../timeline-summary/timeline-summary.constants.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor.js';

const mockPrisma = { company: { groupBy: jest.fn() } };
const mockEnrichmentQueue = { getJobCounts: jest.fn() };
const mockTimelineQueue = { getJobCounts: jest.fn() };
const mockNotificationsQueue = { getJobCounts: jest.fn() };
const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

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

describe('AdminQueuesService', () => {
  let service: AdminQueuesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.company.groupBy.mockResolvedValue([]);
    mockEnrichmentQueue.getJobCounts.mockResolvedValue(counts());
    mockTimelineQueue.getJobCounts.mockResolvedValue(counts());
    mockNotificationsQueue.getJobCounts.mockResolvedValue(counts());

    const module = await Test.createTestingModule({
      providers: [
        AdminQueuesService,
        { provide: PrismaService, useValue: mockPrisma },
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
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(AdminQueuesService);
  });

  it('reports all three queues with their counts', async () => {
    mockEnrichmentQueue.getJobCounts.mockResolvedValue(
      counts({ waiting: 3, active: 1, failed: 2, completed: 118 }),
    );

    const result = await service.getObservability();

    expect(result.queues.map((q) => q.name)).toEqual([
      COMPANY_ENRICHMENT_QUEUE,
      JOB_TIMELINE_SUMMARY_QUEUE,
      NOTIFICATIONS_QUEUE,
    ]);
    expect(result.queues[0]).toEqual({
      name: COMPANY_ENRICHMENT_QUEUE,
      available: true,
      counts: counts({ waiting: 3, active: 1, failed: 2, completed: 118 }),
    });
  });

  it('asks for the counted states explicitly rather than relying on the no-arg shape', async () => {
    await service.getObservability();

    for (const queue of [
      mockEnrichmentQueue,
      mockTimelineQueue,
      mockNotificationsQueue,
    ]) {
      expect(queue.getJobCounts).toHaveBeenCalledWith(
        'waiting',
        'active',
        'delayed',
        'failed',
        'completed',
      );
    }
  });

  it('groups company statuses globally, not per user', async () => {
    await service.getObservability();

    expect(mockPrisma.company.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: true,
    });
  });

  it('labels the null status bucket "Never triggered", not a failure', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: null, _count: 27 },
      { status: EnrichmentStatus.FAILED, _count: 1 },
    ]);

    const result = await service.getObservability();
    const nullBucket = result.companyStatuses.find((b) => b.status === null);

    expect(nullBucket).toEqual({
      status: null,
      label: 'Never triggered',
      count: 27,
    });
    expect(nullBucket?.label).not.toMatch(/fail|no progress/i);
  });

  it('reports zero for status buckets groupBy omitted entirely', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.COMPLETED, _count: 5 },
    ]);

    const result = await service.getObservability();

    expect(result.companyStatuses).toEqual([
      { status: EnrichmentStatus.PENDING, label: 'Queued', count: 0 },
      { status: EnrichmentStatus.PROCESSING, label: 'Processing', count: 0 },
      { status: EnrichmentStatus.COMPLETED, label: 'Completed', count: 5 },
      { status: EnrichmentStatus.FAILED, label: 'Failed', count: 0 },
      { status: null, label: 'Never triggered', count: 0 },
    ]);
  });

  it('derives strandedPending as DB PENDING minus the enrichment queue backlog', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.PENDING, _count: 7 },
    ]);
    mockEnrichmentQueue.getJobCounts.mockResolvedValue(
      counts({ waiting: 2, active: 1, delayed: 1, failed: 9, completed: 99 }),
    );

    const result = await service.getObservability();

    expect(result.strandedPending).toBe(3);
  });

  it('counts a PENDING row with nothing queued at all as stranded', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.PENDING, _count: 1 },
    ]);

    const result = await service.getObservability();

    expect(result.strandedPending).toBe(1);
  });

  it('ignores failed and completed jobs when deciding what is stranded', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.PENDING, _count: 2 },
    ]);
    mockEnrichmentQueue.getJobCounts.mockResolvedValue(
      counts({ waiting: 2, failed: 50, completed: 500 }),
    );

    const result = await service.getObservability();

    expect(result.strandedPending).toBe(0);
  });

  it('floors strandedPending at 0 when the queue holds more jobs than the DB has PENDING rows', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.PENDING, _count: 1 },
    ]);
    mockEnrichmentQueue.getJobCounts.mockResolvedValue(counts({ waiting: 4 }));

    const result = await service.getObservability();

    expect(result.strandedPending).toBe(0);
  });

  it('returns the database half with the queue marked unavailable instead of throwing when Redis is down', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.COMPLETED, _count: 4 },
    ]);
    mockEnrichmentQueue.getJobCounts.mockRejectedValue(
      new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    );

    const result = await service.getObservability();

    expect(result.queues[0]).toEqual({
      name: COMPANY_ENRICHMENT_QUEUE,
      available: false,
      counts: null,
    });
    expect(result.companyStatuses).toContainEqual({
      status: EnrichmentStatus.COMPLETED,
      label: 'Completed',
      count: 4,
    });
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('suppresses strandedPending when the enrichment queue is unavailable, rather than reporting every PENDING row as stranded', async () => {
    mockPrisma.company.groupBy.mockResolvedValue([
      { status: EnrichmentStatus.PENDING, _count: 12 },
    ]);
    mockEnrichmentQueue.getJobCounts.mockRejectedValue(new Error('no redis'));

    const result = await service.getObservability();

    expect(result.strandedPending).toBeNull();
  });

  it('keeps the other queues readable when only one is down', async () => {
    mockTimelineQueue.getJobCounts.mockRejectedValue(new Error('no redis'));
    mockNotificationsQueue.getJobCounts.mockResolvedValue(
      counts({ waiting: 6 }),
    );

    const result = await service.getObservability();

    expect(result.queues[0].available).toBe(true);
    expect(result.queues[1].available).toBe(false);
    expect(result.queues[2].counts?.waiting).toBe(6);
  });

  it('defaults a state the queue omitted from its counts to 0', async () => {
    mockEnrichmentQueue.getJobCounts.mockResolvedValue({ waiting: 2 });

    const result = await service.getObservability();

    expect(result.queues[0].counts).toEqual(counts({ waiting: 2 }));
  });
});
