import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { LlmService } from '../enrichment/services/llm.service.js';
import { JOB_TIMELINE_SUMMARY_QUEUE } from './timeline-summary.constants.js';

// Bounds prompt size/cost for a job with a long event history — a one-line
// summary only needs recent context, not the full timeline. Mirrors
// JobsService.getEvents capping `take` at 200 for the same table, just
// tighter since this feeds an LLM prompt rather than a paginated UI list.
const MAX_EVENTS_FOR_SUMMARY = 50;

@Injectable()
// Same stall-detection margin as CompanyEnrichmentProcessor — single LLM
// call per run, no search/fetch fan-out, so 90s is generous headroom rather
// than a tight fit.
@Processor(JOB_TIMELINE_SUMMARY_QUEUE, { lockDuration: 90_000 })
export class TimelineSummaryProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
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
