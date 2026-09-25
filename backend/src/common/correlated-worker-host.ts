import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { runJobWithRequestId } from './request-context.helper.js';

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
  /** Called by BullMQ for every job; runs `handle` in the job's context. */
  async process(job: TJob, token?: string): Promise<unknown> {
    return runJobWithRequestId(job, () => this.handle(job, token));
  }

  /** The processor's work for one job. */
  protected abstract handle(job: TJob, token?: string): Promise<unknown>;
}
