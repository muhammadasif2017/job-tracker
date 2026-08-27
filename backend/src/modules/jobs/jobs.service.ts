import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isTransactionWriteConflict } from '../../common/prisma-errors.js';
import { CompanyEnrichmentService } from '../companies/enrichment/company-enrichment.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import {
  JobStatus,
  JobEventType,
  JobPriority,
  JobType,
  CompanyCity,
  EnrichmentStatus,
} from '@prisma/client';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../storage/storage.service.js';
import { buildJobWhere } from './jobs.constants.js';

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
    private logger: Logger,
  ) {}

  // Find-or-create, backing a real Job.companyId FK. Case-insensitive exact
  // match, no fuzzy matching (see docs/specs/target-companies.md Assumption
  // 6). Runs the findFirst+create pair inside a Serializable transaction —
  // same pattern as CompaniesService.runNameCheckedWrite — so two concurrent
  // create/update calls racing the same *case-variant* new company name
  // ("Google" vs "google") can't both pass the case-insensitive findFirst
  // and both create: Postgres aborts the loser with P2034 (a plain
  // create-vs-create collision on the exact same name would instead surface
  // as P2002 from the DB's case-sensitive unique constraint). Either error
  // means the other side won the race, so we re-fetch the now-committed row
  // — same fallback shape as the original pre-transaction implementation.
  // Never overwrites an existing company's user-edited/enriched fields as a
  // side effect of linking a job to it. CompanyCity.OTHER is used for
  // auto-created rows since job create/update collects no city. `matched` is
  // true only for a *pre-existing* company match — callers use it to
  // distinguish "linked to a company you already saved" from "we silently
  // auto-created this row" (a race-resolved row counts as the latter, same
  // as the loser of the race would have gotten via a plain, non-concurrent
  // create).
  //
  // `name: { mode: 'insensitive' }` has no matching (userId, lower(name))
  // index, so the findFirst predicate-locks the whole `userId` range of the
  // `(userId, name)` unique index under Serializable isolation. Two
  // concurrent creates for the SAME user always overlap that range, even
  // with completely unrelated company names — Postgres aborts the loser
  // with "could not serialize access due to read/write dependencies" no
  // less often than a genuine same-name collision does. A conflict is
  // therefore NOT reliable evidence that `trimmedName` itself now exists,
  // so a re-fetch-by-name that comes up empty means "transient conflict,
  // nothing to reuse" and must retry the whole transaction rather than
  // rethrow — see the live-DB concurrency e2e added for ADR-029.
  private async resolveCompanyId(
    userId: string,
    trimmedName: string,
    attempt = 1,
  ): Promise<{
    company: { id: string; name: string } | null;
    matched: boolean;
  }> {
    if (!trimmedName) return { company: null, matched: false };
    const MAX_ATTEMPTS = 8;

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.company.findFirst({
            where: {
              userId,
              name: { equals: trimmedName, mode: 'insensitive' },
            },
            select: { id: true, name: true },
          });
          if (existing) return { company: existing, matched: true };

          const created = await tx.company.create({
            data: { userId, name: trimmedName, city: CompanyCity.OTHER },
            select: { id: true, name: true },
          });
          return { company: created, matched: false };
        },
        { isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel },
      );
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
      // isTransactionWriteConflict covers P2034 plus the raw
      // DriverAdapterError shape a commit-time conflict surfaces as (see
      // prisma-errors.ts) — P2002 (a same-name create-vs-create race) is a
      // separate, normally-wrapped case checked alongside it.
      if (code !== 'P2002' && !isTransactionWriteConflict(err)) throw err;

      const raced = await this.prisma.company.findFirst({
        where: { userId, name: { equals: trimmedName, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (raced) return { company: raced, matched: false };

      // No row under this name — the conflict was against some other
      // company's create in the same predicate-locked range, not a
      // same-name race. Retry the whole transaction; only give up once
      // MAX_ATTEMPTS is exhausted. Jittered backoff (not an immediate
      // retry) matters here: several concurrent requests for the same user
      // all lose to each other's predicate lock at once, so retrying in
      // lockstep just re-collides — random delay desyncs the retries so
      // contention actually clears.
      if (attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, 10 + Math.random() * 40 * attempt),
      );
      return this.resolveCompanyId(userId, trimmedName, attempt + 1);
    }
  }

  async create(userId: string, dto: CreateJobDto) {
    const initialStatus = dto.status ?? JobStatus.APPLIED;
    const trimmedCompanyName = dto.company.trim();
    const { company, matched } = await this.resolveCompanyId(
      userId,
      trimmedCompanyName,
    );
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
        priority: dto.priority ?? JobPriority.MEDIUM,
        jobType: dto.jobType ?? JobType.ONSITE,
        discoverySource: dto.discoverySource,
        applicationChannel: dto.applicationChannel,
        notes: dto.notes,
        appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : undefined,
        userId,
        companyId: company?.id,
        events: {
          create: { type: JobEventType.CREATED, toStatus: initialStatus },
        },
      },
    });
    // Company-scoped, not job-scoped (see docs/specs/company-fk-phase3b.md)
    // — one AI research run per company, not duplicated per job at that
    // company. Skipped entirely for a blank company name (nothing to
    // enrich; there's no linked Company).
    if (company) {
      try {
        await this.companyEnrichment.enqueueEnrichment(company.id);
      } catch (err: unknown) {
        // enrichment is best-effort; job creation always succeeds
        this.logger.warn('Enrichment enqueue failed', {
          jobId: job.id,
          companyId: company.id,
          err,
        });
      }
    }

    return { ...job, matchedCompany };
  }

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
      data: jobs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

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

    const { companyLink, ...rest } = job;
    return {
      ...rest,
      // Company is the sole source of enrichment data (CompanyProfile
      // dropped in phase 4, docs/specs/company-fk-phase4.md) — reshaped into
      // the companyProfile response shape the frontend already expects.
      // status defaults to PENDING for a manually-added target company that
      // has never had enrichment triggered (Company.status has no DB
      // default — null there means "never triggered", distinct from an
      // in-flight PENDING/PROCESSING run).
      companyProfile: companyLink
        ? {
            id: companyLink.id,
            jobId: job.id,
            status: companyLink.status ?? EnrichmentStatus.PENDING,
            industry: companyLink.industry,
            companySize: companyLink.companySize,
            techStack: companyLink.techStack,
            cultureSummary: companyLink.cultureSummary,
            workPolicy: companyLink.workPolicy,
            workLifeBalance: companyLink.workLifeBalance,
            headquarters: companyLink.headquarters,
            headquartersLowConfidence: companyLink.headquartersLowConfidence,
            address: companyLink.address,
            addressLowConfidence: companyLink.addressLowConfidence,
            founded: companyLink.founded,
            errorMessage: companyLink.errorMessage,
            enrichedAt: companyLink.enrichedAt,
            createdAt: companyLink.createdAt,
            updatedAt: companyLink.updatedAt,
          }
        : null,
    };
  }

  // Lean ownership check — only selects id + status, no companyLink JOIN.
  // Use this in write operations that don't need enrichment data.
  private async findOwned(userId: string, jobId: string) {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, userId },
      select: { id: true, status: true, company: true, companyId: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // Shared update fields — status is deliberately excluded. Status is either
  // unchanged (nothing to write) or changing (handled by the CAS branch in
  // `update`, below), so it never belongs in this plain field list.
  private buildUpdateData(dto: UpdateJobDto) {
    return {
      company: dto.company,
      position: dto.position,
      location: dto.location,
      url: dto.url,
      priority: dto.priority,
      discoverySource: dto.discoverySource,
      applicationChannel: dto.applicationChannel,
      notes: dto.notes,
      appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : undefined,
    };
  }

  async update(userId: string, jobId: string, dto: UpdateJobDto) {
    const existing = await this.findOwned(userId, jobId);
    const statusChanged = dto.status && dto.status !== existing.status;
    const baseData = this.buildUpdateData(dto);

    // Re-link companyId whenever the caller actually sent a company name —
    // otherwise `company` (the display string) and `companyId` (the FK) can
    // drift apart with nothing to reconcile them. `Job.company` is the label
    // as typed at link time; it deliberately does NOT get retroactively
    // rewritten if the linked Company is later renamed or merged elsewhere —
    // only an explicit edit of this job's company field re-resolves it.
    let data = baseData as typeof baseData & { companyId?: string | null };
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
        const { company } = await this.resolveCompanyId(
          userId,
          trimmedCompany,
        );
        data = { ...baseData, companyId: company?.id ?? null };
      }
    }

    if (!statusChanged) {
      return this.prisma.job.update({
        where: { id: jobId },
        include: { resume: true },
        data,
      });
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
    return this.prisma.$transaction(async (tx) => {
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
  }

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

  async getEvents(userId: string, jobId: string, page = 1, limit = 50) {
    await this.findOwned(userId, jobId);
    return this.prisma.jobEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * limit,
      take: Math.min(limit, 200),
    });
  }
}
