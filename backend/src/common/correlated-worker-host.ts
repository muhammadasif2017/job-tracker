import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { runJobWithRequestId } from './request-context.helper.js';
import { reportError } from '../infrastructure/error-tracking/error-tracking.helper.js';

/**
 * BullMQ errors a processor throws on purpose to steer the job (defer it,
 * wait for children, back off a rate limit). None of them is a failure.
 * Matched by name, as BullMQ itself does, so a second copy of the package
 * can't slip past an `instanceof`.
 */
const CONTROL_FLOW_ERRORS = new Set([
  'DelayedError',
  'WaitingChildrenError',
  'WaitingError',
  'RateLimitError',
]);

/**
 * Whether a job failure will not be retried: an `UnrecoverableError`, or a
 * failure on the last allowed attempt. `attemptsMade` counts the attempts
 * that already failed before this one.
 */
function isFinalFailure(job: Job, err: unknown): boolean {
  const name = err instanceof Error ? err.name : undefined;
  if (name && CONTROL_FLOW_ERRORS.has(name)) return false;
  if (name === 'UnrecoverableError') return true;
  return job.attemptsMade + 1 >= (job.opts?.attempts ?? 1);
}

/**
 * The base every BullMQ processor extends instead of `WorkerHost` (ADR-049).
 * It runs each job inside the correlation context of the request that
 * enqueued it, or of the job itself, so a new processor gets
 * `requestId`-stamped log lines by extending this class rather than by
 * remembering to wrap its own `process`.
 *
 * Subclasses implement `handle`. A worker event handler (`@OnWorkerEvent`)
 * runs outside any job's `process`, so it wraps its own body in
 * `runJobWithRequestId`.
 */
export abstract class CorrelatedWorkerHost<
  TJob extends Job = Job,
> extends WorkerHost {
  /**
   * Called by BullMQ for every job; runs `handle` in the job's context. A
   * failure is reported to Sentry only when it is final (ADR-050): the last
   * allowed attempt, or an `UnrecoverableError`. Earlier attempts will be
   * retried, and a `DelayedError` is a deliberate deferral, not a failure.
   */
  async process(job: TJob, token?: string): Promise<unknown> {
    return runJobWithRequestId(job, async () => {
      try {
        return await this.handle(job, token);
      } catch (err) {
        if (isFinalFailure(job, err)) {
          reportError(err, {
            tags: { queue: job.queueName, jobName: job.name },
            extra: { jobId: job.id, attemptsMade: job.attemptsMade },
          });
        }
        throw err;
      }
    });
  }

  /** The processor's work for one job. */
  protected abstract handle(job: TJob, token?: string): Promise<unknown>;
}
