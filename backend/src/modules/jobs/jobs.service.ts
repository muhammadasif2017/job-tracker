import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { JobStatus, JobEventType, JobPriority, JobType } from '@prisma/client';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../storage/storage.service.js';
import { buildJobWhere } from './jobs.constants.js';

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private enrichment: EnrichmentService,
    @Inject(STORAGE_SERVICE) private storage: IStorageService,
    private logger: Logger,
  ) {}

  async create(userId: string, dto: CreateJobDto) {
    const initialStatus = dto.status ?? JobStatus.APPLIED;
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
        events: {
          create: { type: JobEventType.CREATED, toStatus: initialStatus },
        },
      },
    });
    try {
      await this.enrichment.enqueueEnrichment(job.id);
    } catch (err: unknown) {
      // enrichment is best-effort; job creation always succeeds
      this.logger.warn('Enrichment enqueue failed', { jobId: job.id, err });
    }

    // Soft-link only (no FK) — surfaces a "you already saved this company"
    // banner on the frontend. Case-insensitive exact match, no fuzzy
    // matching (see docs/specs/target-companies.md Assumption 6).
    const matchedCompany = await this.prisma.company.findFirst({
      where: { userId, name: { equals: dto.company, mode: 'insensitive' } },
      select: { id: true, name: true },
    });

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
        companyProfile: true,
        resume: true,
        interviewRounds: { orderBy: { scheduledAt: 'asc' } },
        contacts: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }

  // Lean ownership check — only selects id + status, no companyProfile JOIN.
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
        include: { companyProfile: true, resume: true },
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
        include: { companyProfile: true, resume: true },
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
