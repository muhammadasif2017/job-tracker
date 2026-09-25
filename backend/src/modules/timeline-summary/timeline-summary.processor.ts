import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { LlmService } from '../enrichment/services/llm.service.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from './timeline-summary.constants.js';
import { runJobWithRequestId } from '../../common/request-context.helper.js';
import { withWorkerConnection } from '../../infrastructure/redis/redis-connection.helper.js';

/**
 * Bounds prompt size and cost for a job with a long event history — a
 * one-line summary needs recent context, not the full timeline. Mirrors
 * `JobsService.getEvents` capping `take` at 200 for the same table, tighter
 * because this feeds an LLM prompt rather than a paginated UI list.
 */
const MAX_EVENTS_FOR_SUMMARY = 50;

/**
 * Worker that writes a job's LLM timeline summary. Runs are coalesced per job
 * by `TimelineSummaryService.enqueue`.
 *
 * `lockDuration` is the same stall-detection margin as
 * `CompanyEnrichmentProcessor`, not a runtime ceiling: BullMQ renews the lock
 * while `process()` runs.
 */
@Injectable()
@Processor(
  JOB_TIMELINE_SUMMARY_QUEUE,
  withWorkerConnection({ lockDuration: 90_000 }),
)
export class TimelineSummaryProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly logger: Logger,
  ) {
    super();
  }

  /**
   * Runs the job inside the correlation context of the request that enqueued
   * it, so its log lines share that request's `requestId` (ADR-049).
   */
  async process(
    job: Job<{ jobId: string; requestId?: string }>,
  ): Promise<void> {
    return runJobWithRequestId(job, () => this.summarize(job));
  }

  /**
   * Summarizes the job's most recent events and stores the result. Rethrows
   * on failure so BullMQ retries; the previous summary stays in place until a
   * run succeeds.
   */
  private async summarize(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;

    const dbJob = await this.prisma.job.findFirst({
      where: { id: jobId },
      select: { id: true, company: true, position: true },
    });
    if (!dbJob) {
      this.logger.warn('timeline_summary_job_not_found', { jobId });
      return;
    }

    try {
      // Most recent MAX_EVENTS_FOR_SUMMARY, then reversed back to
      // chronological order for the prompt — desc+take is what lets Postgres
      // use the index to grab the tail without scanning the whole table.
      const recentEvents = await this.prisma.jobEvent.findMany({
        where: { jobId },
        orderBy: { createdAt: 'desc' },
        take: MAX_EVENTS_FOR_SUMMARY,
      });
      if (!recentEvents.length) return;
      const events = recentEvents.reverse();

      const summary = await this.llm.summarizeEvents(events, {
        company: dbJob.company,
        position: dbJob.position,
      });

      // Re-check existence — the job may have been deleted while the LLM
      // call was in flight (same race CompanyEnrichmentProcessor guards).
      const stillExists = await this.prisma.job.findFirst({
        where: { id: jobId },
        select: { id: true },
      });
      if (!stillExists) {
        this.logger.log('timeline_summary_job_deleted_during_processing', {
          jobId,
        });
        return;
      }

      await this.prisma.job.update({
        where: { id: jobId },
        data: { timelineSummary: summary, timelineSummaryAt: new Date() },
      });
    } catch (error) {
      this.logger.warn('timeline_summary_failed', {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
