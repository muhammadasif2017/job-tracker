import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';

@Injectable()
export class CompanyEnrichmentService {
  constructor(
    @InjectQueue(COMPANY_ENRICHMENT_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueEnrichment(companyId: string): Promise<void> {
    // Company.status already exists with a PENDING default from creation
    // (unlike Job's CompanyProfile, which is created lazily on first
    // enrichment) — a plain update, no upsert needed.
    await this.prisma.company.update({
      where: { id: companyId },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });
    await this.enqueue(companyId);
  }

  // The auto-trigger path (adding a job at a company), as opposed to
  // enqueueEnrichment above, which backs the user's explicit Refresh button
  // and must always run.
  //
  // Fires only for a company enrichment has never been attempted on
  // (`status: null`). Every other state is deliberately skipped:
  //
  // - COMPLETED: we already hold the profile. Re-running to rediscover facts
  //   we have is what drained the Tavily quota — a run costs 1-2 searches,
  //   doubled by the retry policy in enqueue(), and a company with N jobs
  //   was paying that N times.
  // - PENDING/PROCESSING: a run already owns the row. This is also what
  //   makes the `updateMany` a CAS claim (same pattern as
  //   CompaniesService.triggerEnrichment): only the first of a burst of job
  //   creations at one new company still finds `status: null`, so the burst
  //   queues one run rather than one per job.
  // - FAILED: a company we could not enrich once (no website and no search
  //   hits — the common shape for small employers) would otherwise re-burn
  //   search credits on every job added at it, forever. Recovery is the
  //   Refresh button, which CompanyProfileCard already renders prominently
  //   on a failed profile.
  //
  // `enrichedAt: null` is redundant against `status: null` for rows this
  // codebase writes (nothing sets one without the other) and is kept as a
  // guard for any row predating that invariant.
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

  private async enqueue(companyId: string): Promise<void> {
    await this.queue.add(
      'enrich',
      { companyId },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  }
}
