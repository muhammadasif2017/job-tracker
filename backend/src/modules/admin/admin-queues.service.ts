import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from '../companies/enrichment/company-enrichment.constants.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from '../timeline-summary/timeline-summary.constants.js';
import { NOTIFICATIONS_QUEUE } from '../notifications/notifications.processor.js';
import {
  CompanyStatusBucketDto,
  QueueObservabilityDto,
  QueueSnapshotDto,
} from './dto/admin-queues.dto.js';
import {
  COUNTED_STATES,
  NEVER_TRIGGERED_LABEL,
  STATUS_LABELS,
  STATUS_ORDER,
} from './admin-queues.constants.js';

@Injectable()
export class AdminQueuesService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(COMPANY_ENRICHMENT_QUEUE)
    private readonly enrichmentQueue: Queue,
    @InjectQueue(JOB_TIMELINE_SUMMARY_QUEUE)
    private readonly timelineSummaryQueue: Queue,
    @InjectQueue(NOTIFICATIONS_QUEUE)
    private readonly notificationsQueue: Queue,
    private readonly logger: Logger,
  ) {}

  async getObservability(): Promise<QueueObservabilityDto> {
    const [queues, grouped] = await Promise.all([
      Promise.all([
        this.snapshot(COMPANY_ENRICHMENT_QUEUE, this.enrichmentQueue),
        this.snapshot(JOB_TIMELINE_SUMMARY_QUEUE, this.timelineSummaryQueue),
        this.snapshot(NOTIFICATIONS_QUEUE, this.notificationsQueue),
      ]),
      // Global, not user-scoped — consistent with AdminService.listUsers.
      this.prisma.company.groupBy({ by: ['status'], _count: true }),
    ]);

    const counts = new Map<EnrichmentStatus | null, number>(
      grouped.map((row) => [row.status, row._count]),
    );

    const companyStatuses: CompanyStatusBucketDto[] = STATUS_ORDER.map(
      (status) => ({
        status,
        label: status === null ? NEVER_TRIGGERED_LABEL : STATUS_LABELS[status],
        // groupBy omits buckets with no rows, so an absent key means zero.
        count: counts.get(status) ?? 0,
      }),
    );

    return {
      queues,
      companyStatuses,
      strandedPending: this.strandedPending(
        counts.get(EnrichmentStatus.PENDING) ?? 0,
        queues[0],
      ),
    };
  }

  /**
   * DB rows sitting at PENDING with nothing to run them. These render as
   * "Queued…" forever and `CompaniesService.triggerEnrichment` answers a retry
   * with 409, so the user has no way out through the UI.
   *
   * Returns null when the queue is unreachable: `waiting + active + delayed`
   * would read as 0 and every legitimately queued row would be reported as
   * stranded, which is a false alarm on the one signal this panel exists for.
   */
  private strandedPending(
    pendingInDb: number,
    enrichment: QueueSnapshotDto,
  ): number | null {
    if (!enrichment.counts) return null;
    const { waiting, active, delayed } = enrichment.counts;
    return Math.max(0, pendingInDb - (waiting + active + delayed));
  }

  /**
   * Per queue rather than one try around all three: a single dead queue must
   * not blank out the other two, and a Redis outage must not 500 the endpoint
   * when the database half of the answer is still available.
   */
  private async snapshot(
    name: string,
    queue: Queue,
  ): Promise<QueueSnapshotDto> {
    try {
      const counts = await queue.getJobCounts(...COUNTED_STATES);
      return {
        name,
        available: true,
        counts: {
          waiting: counts.waiting ?? 0,
          active: counts.active ?? 0,
          delayed: counts.delayed ?? 0,
          failed: counts.failed ?? 0,
          completed: counts.completed ?? 0,
        },
      };
    } catch (error) {
      this.logger.warn(
        { err: error, queue: name },
        'Queue counts unavailable; returning the database half only',
      );
      return { name, available: false, counts: null };
    }
  }
}
