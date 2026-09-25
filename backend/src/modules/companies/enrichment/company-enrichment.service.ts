import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';
import { withRequestId } from '../../../common/request-context.helper.js';

/**
 * Queues company enrichment runs. There are two enqueue methods and picking
 * the wrong one costs Tavily quota: `enqueueEnrichment` always runs and
 * belongs to the user's explicit Refresh button, `enqueueIfStale` is the
 * automatic path and fires at most once per company (ADR-035).
 */
@Injectable()
export class CompanyEnrichmentService {
  constructor(
    @InjectQueue(COMPANY_ENRICHMENT_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The unconditional path, for the Refresh button and for a company the
   * user created by hand. Never call this from an automatic trigger — that
   * is the bug ADR-035 fixes.
   */
  async enqueueEnrichment(companyId: string): Promise<void> {
    // The Company row always exists by the time this runs (status starts
    // null) — a plain update, no upsert needed.
    await this.prisma.company.update({
      where: { id: companyId },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });

    // Same stranding hazard enqueueIfStale guards against below: a failed
    // add would leave PENDING with nothing queued, and triggerEnrichment's
    // CAS answers PENDING with a 409, so Refresh could never recover it.
    // FAILED rather than the prior status: Refresh accepts it, and
    // CompanyProfileCard renders prior fields plus a retry banner on it.
    // Guarded on PENDING so a worker that did pick the job up (an add whose
    // reply was lost) isn't clobbered.
    try {
      await this.enqueue(companyId);
    } catch (err) {
      await this.prisma.company
        .updateMany({
          where: { id: companyId, status: EnrichmentStatus.PENDING },
          data: {
            status: EnrichmentStatus.FAILED,
            errorMessage: 'Could not queue enrichment',
          },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * The automatic path, taken when a job is added at a company.
   *
   * Fires only for a company enrichment has never been attempted on. Every
   * other state is deliberately skipped, and the claim is the same
   * compare-and-swap pattern as `CompaniesService.triggerEnrichment`. COMPLETED already holds the
   * profile, and re-running to rediscover facts we have is what drained the
   * quota — a run costs one or two searches, doubled by the retry policy,
   * and a company with N jobs was paying that N times. PENDING and
   * PROCESSING mean a run already owns the row; that is also what makes the
   * `updateMany` a compare-and-swap claim, so a burst of job creations at
   * one new company queues a single run. FAILED usually means a small
   * employer with no website and no search hits, which would otherwise
   * re-burn credits on every job added at it forever; recovery is the
   * Refresh button, which `CompanyProfileCard` already renders prominently
   * on a failed profile.
   *
   * The `enrichedAt: null` half of the condition is redundant against
   * `status: null` for rows this codebase writes, and is kept as a guard
   * for any row predating that invariant.
   */
  async enqueueIfStale(companyId: string): Promise<void> {
    const { count } = await this.prisma.company.updateMany({
      where: { id: companyId, status: null, enrichedAt: null },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });
    if (count === 0) return;

    // Releasing the claim on a failed enqueue is what keeps this gate from
    // stranding a company. The status update has to come first (a worker
    // that picks the job up immediately would otherwise have PROCESSING
    // clobbered back to PENDING), so a Redis outage between the two leaves
    // the row at PENDING with nothing queued — and PENDING is skipped by
    // this method *and* rejected by CompaniesService.triggerEnrichment's
    // CAS, so neither a later job add nor the Refresh button could ever
    // recover it. Rolling the status back to null restores exactly the
    // state the claim found. The caller still sees the error (job creation
    // treats it as best-effort and logs it).
    try {
      await this.enqueue(companyId);
    } catch (err) {
      await this.prisma.company
        .updateMany({
          where: { id: companyId, status: EnrichmentStatus.PENDING },
          data: { status: null },
        })
        .catch(() => undefined);
      throw err;
    }
  }

  /**
   * The bare queue add both paths funnel through. Two attempts, because a
   * third would triple the search cost of a run that is failing for a
   * reason retrying cannot fix.
   */
  private async enqueue(companyId: string): Promise<void> {
    await this.queue.add(
      'enrich',
      // Carries the enqueuing request's correlation ID into the worker's logs.
      withRequestId({ companyId }),
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  }
}
