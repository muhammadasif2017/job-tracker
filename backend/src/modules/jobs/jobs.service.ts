import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CompanyEnrichmentService } from '../companies/enrichment/company-enrichment.service.js';
import { TimelineSummaryService } from '../timeline-summary/timeline-summary.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { JobStatus, JobEventType, JobType } from '@prisma/client';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../storage/storage.service.js';
import { buildJobWhere, upcomingInterviewAt } from './jobs.constants.js';
import { JobCompanyLinkService } from './job-company-link.service.js';
import { JobGhostingService } from './job-ghosting.service.js';
import { civilDateFromInput, todayFor } from './jobs-dates.helper.js';
import { buildUpdateData } from './job-update-data.helper.js';
import { bestEffortEnqueueTimelineSummary } from './timeline-summary-enqueue.helper.js';
import { deriveInterviewRoundStatus } from '../interview-rounds/interview-round-status.util.js';

/**
 * `Job.nextInterviewAt` goes stale on its own: `InterviewRoundsService`
 * recomputes it on every round write, but nothing touches it when time
 * simply passes, so a past instant keeps claiming to be the next interview.
 * Every read path that hands a job to a client runs it through this —
 * `findOne`, `findAll`, the PATCH response and the CSV export.
 *
 * Missing it on any one of them is enough: `usePatchJobStatusMutation`
 * merges the PATCH response over the cached detail job, so an un-nulled
 * value there resurrects the stale date on a page that had already cleaned
 * it.
 */
function withUpcomingInterview<T extends { nextInterviewAt: Date | null }>(
  job: T,
): T {
  return { ...job, nextInterviewAt: upcomingInterviewAt(job.nextInterviewAt) };
}

/**
 * The core of the app: the jobs a user is tracking, their status history,
 * and the company each one links to.
 *
 * Two invariants run through everything here. Every method that touches a
 * specific job scopes the query by `userId`, so another user's job is
 * indistinguishable from one that does not exist — 404 for both, never 403.
 * And `Job.appliedAt` holds a civil date, UTC midnight standing in for a
 * calendar day, never a real time of day (ADR-034).
 */
@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
    private timelineSummary: TimelineSummaryService,
    private companyLink: JobCompanyLinkService,
    private ghosting: JobGhostingService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
    private logger: Logger,
  ) {}

  /**
   * Timeline-summary regeneration is best-effort — a queue or model hiccup
   * must never fail the job mutation that triggered it.
   */
  private enqueueTimelineSummary(jobId: string): Promise<void> {
    return bestEffortEnqueueTimelineSummary(
      this.timelineSummary,
      this.logger,
      jobId,
    );
  }

  /**
   * Creates a job, links or auto-creates its company, writes the CREATED
   * timeline event in the same statement, and queues enrichment for a
   * company that has never had any.
   *
   * `appliedAt` is always set explicitly, on every path: the schema's
   * `@default(now())` would write a real timestamp and break the civil-date
   * invariant, so the default must never fire.
   */
  async create(userId: string, dto: CreateJobDto) {
    const initialStatus = dto.status ?? JobStatus.APPLIED;
    const trimmedCompanyName = dto.company.trim();
    const [{ company, matched }, appliedAt] = await Promise.all([
      this.companyLink.resolveCompanyId(
        userId,
        trimmedCompanyName,
        dto.location,
      ),
      dto.appliedAt
        ? Promise.resolve(civilDateFromInput(dto.appliedAt))
        : todayFor(this.prisma, userId),
    ]);
    // matchedCompany drives the "saved as a target company" banner in the
    // response — must stay null for a row we just silently auto-created.
    const matchedCompany = matched ? company : null;

    const job = await this.prisma.job.create({
      data: {
        company: dto.company,
        position: dto.position,
        location: dto.location,
        url: dto.url || undefined,
        status: initialStatus,
        jobType: dto.jobType ?? JobType.ONSITE,
        discoverySource: dto.discoverySource,
        applicationChannel: dto.applicationChannel,
        notes: dto.notes,
        // Always explicit — never `undefined`, which would let the schema's
        // `@default(now())` write a real timestamp and break the invariant.
        appliedAt,
        userId,
        companyId: company?.id,
        events: {
          create: { type: JobEventType.CREATED, toStatus: initialStatus },
        },
      },
    });
    // Kept inline rather than routed through
    // `JobCompanyLinkService.enqueueRelinkedCompany`: same best-effort
    // contract and same log line, but this is the create path, not a
    // re-link. Change one and change the other.
    //
    // Company-scoped, not job-scoped (see docs/specs/company-fk-phase3b.md)
    // — one AI research run per company, not duplicated per job at that
    // company. enqueueIfStale, not enqueueEnrichment, is what actually
    // enforces that "not duplicated": it no-ops for a company already
    // enriched, already running, or already failed (ADR-035). Skipped
    // entirely for a blank company name (nothing to enrich; there's no
    // linked Company).
    if (company) {
      try {
        await this.companyEnrichment.enqueueIfStale(company.id);
      } catch (err: unknown) {
        // enrichment is best-effort; job creation always succeeds
        this.logger.warn('Enrichment enqueue failed', {
          jobId: job.id,
          companyId: company.id,
          err,
        });
      }
    }

    await this.enqueueTimelineSummary(job.id);

    return { ...job, matchedCompany };
  }

  /**
   * One page of the user's jobs, with the list view's filters, search and
   * sort applied. Every sort but `createdAt` carries `createdAt` as a
   * tiebreaker, so rows sharing a value keep a stable order across pages.
   */
  async findAll(userId: string, query: JobQueryDto) {
    const {
      page = 1,
      limit = 10,
      sortBy = 'appliedAt',
      sortOrder = 'desc',
    } = query;

    const where = buildJobWhere(userId, query);

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy:
          sortBy === 'createdAt'
            ? { createdAt: sortOrder }
            : [{ [sortBy]: sortOrder }, { createdAt: sortOrder }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      data: jobs.map(withUpcomingInterview),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * The job detail view: the job with its company, resume, interview rounds
   * and contacts. Do not call this merely to check ownership — `findOwned`
   * is the lean version for that.
   */
  async findOne(userId: string, jobId: string) {
    // Scope by userId so a job owned by another user is indistinguishable
    // from one that doesn't exist (404 for both — no existence leak).
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      include: {
        companyLink: true,
        resume: true,
        interviewRounds: { orderBy: { scheduledAt: 'asc' } },
        contacts: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    const { companyLink, interviewRounds, ...rest } = job;
    return {
      ...rest,
      // Null out a stale past value rather than showing it as "next" — see
      // upcomingInterviewAt in jobs.constants.ts.
      nextInterviewAt: upcomingInterviewAt(rest.nextInterviewAt),
      // InterviewRoundsService attaches this same field for its own
      // create/findAll/update responses — this include bypasses that
      // service entirely, so it must be computed here too (see the "no
      // effect for Liquid Technologies" bug this fixes: the job detail page
      // renders job.interviewRounds from this response, never the
      // /jobs/:jobId/interview-rounds endpoints).
      interviewRounds: interviewRounds.map((round) => ({
        ...round,
        derivedStatus: deriveInterviewRoundStatus(
          round.outcome,
          round.scheduledAt,
        ),
      })),
      // Company is the sole source of enrichment data (CompanyProfile
      // dropped in phase 4, docs/specs/company-fk-phase4.md) — reshaped into
      // the companyProfile response shape the frontend already expects.
      //
      // `status` is passed through as-is, null included. It used to be
      // coerced to PENDING here, which collapsed "never triggered" into
      // "queued and running": CompanyProfileCard renders PENDING as a
      // "Queued…" spinner with no Refresh button, so a company nothing had
      // ever enqueued (a CSV import, or the re-link bug fixed in #314)
      // looked permanently in-flight and had no recovery path on this page.
      // The company-detail page never coerced, which is why the same card
      // showed a working Refresh button there and not here.
      companyProfile: companyLink
        ? {
            id: companyLink.id,
            jobId: job.id,
            status: companyLink.status,
            industry: companyLink.industry,
            companySize: companyLink.companySize,
            techStack: companyLink.techStack,
            cultureSummary: companyLink.cultureSummary,
            productDescription: companyLink.productDescription,
            businessMode: companyLink.businessMode,
            errorMessage: companyLink.errorMessage,
            enrichedAt: companyLink.enrichedAt,
            createdAt: companyLink.createdAt,
            updatedAt: companyLink.updatedAt,
          }
        : null,
    };
  }

  /**
   * Lean ownership check for writes, selecting only the columns the write
   * itself reads back — no joins. `appliedAt` is among them so `update` can
   * tell a date the user actually changed from the pre-filled one the form
   * resends untouched.
   */
  private async findOwned(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      // `appliedAt` is here so `update` can tell a date the user actually
      // changed from the pre-filled one JobForm resends untouched.
      select: {
        id: true,
        status: true,
        company: true,
        companyId: true,
        appliedAt: true,
        // Fallback enrichment anchor for a re-link that doesn't resend it.
        location: true,
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  /**
   * Edits a job. Three things here are more than a field write.
   *
   * A status change is a compare-and-swap against the status just read,
   * paired with its timeline event inside one transaction — that is what
   * closes the race between a manual edit and an interview-round
   * auto-promotion (ADR-018).
   *
   * A company label is only re-resolved when it actually differs from the
   * stored one. The form resends the current label on every submit, so "the
   * client sent it" cannot mean "the user changed it" — and re-resolving a
   * stale label would retroactively rewrite a link after the company was
   * renamed or merged elsewhere (ADR-030). Clearing the label outright is
   * rejected: `Job.company` is a required column with no "unlinked" state
   * to clear into.
   *
   * Leaving WISHLIST in any direction re-stamps `appliedAt` to the user's
   * today, because every "applications sent" metric dates from that column
   * and would otherwise date the application from the save (ADR-033,
   * ADR-034).
   */
  async update(userId: string, jobId: string, dto: UpdateJobDto) {
    const existing = await this.findOwned(userId, jobId);
    const statusChanged = dto.status && dto.status !== existing.status;
    const baseData = buildUpdateData(dto);

    // Re-link companyId whenever the caller actually sent a company name —
    // otherwise `company` (the display string) and `companyId` (the FK) can
    // drift apart with nothing to reconcile them. `Job.company` is the label
    // as typed at link time; it deliberately does NOT get retroactively
    // rewritten if the linked Company is later renamed or merged elsewhere —
    // only an explicit edit of this job's company field re-resolves it.
    let data = baseData as typeof baseData & { companyId?: string | null };
    // Set only when this edit actually re-resolved the label to a Company —
    // that row may have just been auto-created by resolveCompanyId, and
    // nothing else would ever queue enrichment for it (see the enqueue after
    // the write branches below).
    let relinkedCompanyId: string | null = null;
    if (dto.company === null) {
      // Job.company is a required, non-nullable column — unlike the
      // optional profile fields this repo's convention lets a client clear
      // with an explicit null, there is no "no company" state to unlink
      // into. `IsOptional()` (added by PartialType) lets null past DTO
      // validation, so this must be rejected explicitly rather than falling
      // through to `.trim()` on null.
      throw new BadRequestException(
        'company cannot be cleared — omit the field to leave it unchanged',
      );
    }
    if (dto.company !== undefined) {
      const trimmedCompany = dto.company.trim();
      // JobForm always resends the pre-filled `company` label on every
      // submit, even when the user only touched an unrelated field — so
      // "dto.company !== undefined" alone can't mean "user edited it". If
      // the trimmed label still matches the current label and a companyId
      // is already linked, treat it as a no-op instead of re-resolving:
      // re-resolving a stale label after the linked Company was renamed or
      // merged elsewhere would silently re-link to (or recreate) a
      // different company, undoing that rename/merge on an unrelated edit.
      const matchesCurrentLabel =
        existing.companyId !== null &&
        trimmedCompany.toLowerCase() === existing.company.toLowerCase();
      if (!matchesCurrentLabel) {
        // Same location anchor create() seeds onto an auto-created company.
        // An explicit null (location cleared in this edit) wins over the
        // stored value; only an omitted field falls back to it.
        const { company } = await this.companyLink.resolveCompanyId(
          userId,
          trimmedCompany,
          dto.location !== undefined ? dto.location : existing.location,
        );
        data = { ...baseData, companyId: company?.id ?? null };
        relinkedCompanyId = company?.id ?? null;
      }
    }

    // `Job.appliedAt` is `@default(now())`, so a job saved to the wishlist in
    // June already carries June as its application date — and nothing used to
    // move it when the user actually applied. Every "applications sent"
    // metric reads that column (getStats.thisMonth, the trend buckets, the
    // 30d/90d range filters, the CSV "Applied Date", the default list sort),
    // so applying today to a long-wishlisted job was reported as an
    // application made months ago: absent from this month's count, plotted on
    // the wrong bar, and sorted to the bottom of the list.
    //
    // Leaving WISHLIST in any direction is the moment it becomes a real
    // application (the kanban board lets you drag straight to INTERVIEWING),
    // so stamp it here — with the user's own today, since the column is a
    // civil date (ADR-034).
    //
    // The guard is "the client sent an appliedAt *different from the stored
    // one*", not merely "sent one at all". JobForm resends every field on
    // every submit, including the untouched pre-filled date, so an
    // `!== undefined` check meant the re-stamp fired on a kanban drag and
    // silently didn't on the exact same transition made through the edit
    // form. A date the user genuinely changed still wins.
    const leftWishlist =
      statusChanged && existing.status === JobStatus.WISHLIST;
    const submittedAppliedAt = baseData.appliedAt;
    const appliedAtEdited =
      submittedAppliedAt !== undefined &&
      submittedAppliedAt.getTime() !== existing.appliedAt.getTime();
    if (leftWishlist && !appliedAtEdited) {
      data = { ...data, appliedAt: await todayFor(this.prisma, userId) };
    }

    if (!statusChanged) {
      const updated = await this.prisma.job.update({
        where: { id: jobId },
        include: { resume: true },
        data,
      });
      await this.companyLink.enqueueRelinkedCompany(jobId, relinkedCompanyId);
      return withUpcomingInterview(updated);
    }

    // Status is changing — CAS the transition on the status we just read
    // (WHERE id AND status = existing.status) instead of writing
    // unconditionally. If a concurrent mutation (e.g. an interview-round
    // auto-promotion — see InterviewRoundsService.logRoundEvent) changed the
    // status in between, `count` comes back 0 and we reject rather than
    // record a `fromStatus` that's no longer true. This is why the event
    // isn't nested inside the job update here, unlike the normal pattern
    // (see backend CLAUDE.md, "Jobs: Event Logging") — updateMany can't
    // carry a nested create, so both statements run inside one transaction
    // instead.
    const result = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.job.updateMany({
        where: { id: jobId, status: existing.status },
        data: { status: dto.status },
      });
      if (count === 0) {
        throw new ConflictException(
          'Job status changed concurrently — refresh and try again',
        );
      }
      await tx.jobEvent.create({
        data: {
          jobId,
          type: JobEventType.STATUS_CHANGE,
          fromStatus: existing.status,
          toStatus: dto.status!,
        },
      });
      return tx.job.update({
        where: { id: jobId },
        include: { resume: true },
        data,
      });
    });

    await this.companyLink.enqueueRelinkedCompany(jobId, relinkedCompanyId);
    await this.enqueueTimelineSummary(jobId);
    return withUpcomingInterview(result);
  }

  /**
   * The bulk "mark all ghosted" action — see `JobGhostingService`.
   */
  markGhosted(userId: string, jobIds: string[]) {
    return this.ghosting.markGhosted(userId, jobIds);
  }

  /**
   * Quiets the ghost suggestion for one job — see `JobGhostingService`.
   */
  dismissGhostSuggestion(userId: string, jobId: string) {
    return this.ghosting.dismissGhostSuggestion(userId, jobId);
  }

  /**
   * Deletes a job. The resume's storage key is read before the delete,
   * since the row disappears with the job by cascade but the file itself is
   * outside Prisma's reach; the file delete afterwards is best-effort.
   */
  async remove(userId: string, jobId: string) {
    const resume = await this.prisma.resume.findFirst({
      where: { jobId, job: { userId } },
      select: { storageKey: true },
    });

    const { count } = await this.prisma.job.deleteMany({
      where: { id: jobId, userId },
    });
    if (count === 0) throw new NotFoundException('Job not found');

    if (resume) {
      await this.storage.delete(resume.storageKey).catch((err: unknown) =>
        this.logger.warn('Storage delete failed after job remove', {
          storageKey: resume.storageKey,
          err,
        }),
      );
    }

    return { message: 'Job deleted' };
  }

  /**
   * One page of a job's timeline events.
   *
   * Newest first: with ascending order, page 1 of a busy job returns the
   * oldest slice and the recent activity — the only part anyone reads on a
   * timeline — is silently dropped. Callers that render oldest-to-newest
   * reverse the page themselves. The id is the tiebreaker because
   * timestamps are not unique here: job creation nests its CREATED event,
   * and round logging writes inside the same transaction as its round, so
   * same-millisecond rows are normal, and without it a row can repeat or
   * vanish across a page boundary.
   *
   * The page offset is derived from the capped page size rather than the
   * raw limit, so pages stay contiguous even for an internal caller that
   * bypasses the controller's validation. The rows and the total are
   * independent reads and can reflect different snapshots under a
   * concurrent write — acceptable for a read-only display.
   */
  async getEvents(userId: string, jobId: string, page = 1, limit = 50) {
    await this.findOwned(userId, jobId);
    const take = Math.min(limit, 200);
    // skip is derived from `take` (the capped page size), not the raw
    // `limit` — pages must be contiguous even if a caller bypasses the
    // controller's @Max(200) DTO validation with a raw internal call.
    // findMany and count are independent, unsynchronized reads — under a
    // concurrent event write mid-request, `data` and `meta.total` can
    // reflect different snapshots. Acceptable here since this only backs a
    // read-only timeline display, not a CAS-guarded write.
    //
    // Newest-first, not oldest-first: with ascending order, page 1 of a job
    // with more events than `take` returns the *oldest* slice and the
    // recent activity — the only part anyone reads on a timeline — is
    // silently dropped. Callers that render oldest-to-newest reverse the
    // page client-side.
    //
    // `id` is the tiebreaker because `createdAt` is not unique: job create
    // nests its CREATED event, and logRoundEvent writes inside the same
    // transaction as its round, so same-millisecond timestamps are normal.
    // Without it, a row can repeat or vanish across page boundaries.
    const [events, total] = await Promise.all([
      this.prisma.jobEvent.findMany({
        where: { jobId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * take,
        take,
      }),
      this.prisma.jobEvent.count({ where: { jobId } }),
    ]);

    return {
      data: events,
      meta: { total, page, limit: take, totalPages: Math.ceil(total / take) },
    };
  }
}
