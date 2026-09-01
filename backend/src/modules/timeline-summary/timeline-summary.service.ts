import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { JOB_TIMELINE_SUMMARY_QUEUE } from './timeline-summary.constants.js';

@Injectable()
export class TimelineSummaryService {
  constructor(
    @InjectQueue(JOB_TIMELINE_SUMMARY_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(jobId: string): Promise<void> {
    // A stable BullMQ jobId (distinct from the payload's jobId field) makes
    // this idempotent: adding while a job with the same id is still
    // waiting/delayed coalesces into that one instead of enqueuing a
    // duplicate. Without this, a burst of writes on the same job (round
    // added, then its outcome edited, then a status change) would enqueue
    // one Groq call per write instead of one for the whole burst.
    await this.queue.add(
      'summarize',
      { jobId },
      {
        jobId: `summarize-${jobId}`,
        attempts: 2,
        backoff: { type: 'fixed', delay: 10_000 },
      },
    );
  }
}
