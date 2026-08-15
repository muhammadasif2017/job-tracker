import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
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

  async create(userId: string, dto: CreateJobDto) {
    const initialStatus = dto.status ?? JobStatus.APPLIED;
    // Find-or-create, backing a real Job.companyId FK. Case-insensitive
    // exact match, no fuzzy matching (see docs/specs/target-companies.md
    // Assumption 6) — findFirst first, create only on a miss, and re-fetch
    // on a unique-constraint race (two concurrent creates of the same new
    // company name). Never overwrites an existing company's user-edited/
    // enriched fields as a side effect of creating a job. CompanyCity.OTHER
    // is used for auto-created rows since job-create collects no city.
    const trimmedCompanyName = dto.company.trim();
    // matchedCompany is only ever a *pre-existing* target company — it drives
    // the "saved as a target company" banner in the response, which must not
    // fire for a company row we silently auto-created just now. company is
    // the row backing Job.companyId either way (found or newly created).
    const matchedCompany = trimmedCompanyName
      ? await this.prisma.company.findFirst({
          where: {
            userId,
            name: { equals: trimmedCompanyName, mode: 'insensitive' },
          },
          select: { id: true, name: true },
        })
      : null;
    let company = matchedCompany;

    if (trimmedCompanyName && !company) {
      try {
        company = await this.prisma.company.create({
          data: { userId, name: trimmedCompanyName, city: CompanyCity.OTHER },
          select: { id: true, name: true },
        });
      } catch (err: unknown) {
        // Unique-constraint race: another request created the same company
        // between our findFirst and create. Re-fetch instead of failing
        // job creation.
        company = await this.prisma.company.findFirst({
          where: {
            userId,
            name: { equals: trimmedCompanyName, mode: 'insensitive' },
          },
          select: { id: true, name: true },
        });
        if (!company) throw err;
      }
    }

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
        orderBy: { [sortBy]: sortOrder },
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
      select: { id: true, status: true },
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
    const data = this.buildUpdateData(dto);

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
