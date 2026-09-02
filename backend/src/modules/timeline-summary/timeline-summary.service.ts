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
    //
    // removeOnComplete/removeOnFail are what keep that coalescing scoped to
    // the burst instead of lasting forever. BullMQ's add script skips the
    // enqueue whenever a hash under this jobId still EXISTS — in *any*
    // state, terminal ones included — and it keeps finished jobs by default
    // (an unset removeOnComplete becomes keepJobs {count: -1}). So without
    // these, the first run's leftover `summarize-<jobId>` hash would swallow
    // every later enqueue for that job and the summary would freeze at its
    // first version, silently, until Redis was wiped.
    await this.queue.add(
      'summarize',
      { jobId },
      {
        jobId: `summarize-${jobId}`,
        attempts: 2,
        backoff: { type: 'fixed', delay: 10_000 },
        removeOnComplete: true,
        // Removed only once `attempts` is exhausted — intermediate retries
        // stay in the queue — so a permanently failed summary still frees
        // the jobId for the job's next mutation to retry from scratch.
        removeOnFail: true,
      },
    );
  }
}
