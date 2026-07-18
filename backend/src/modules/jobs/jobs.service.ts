import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { JobStatus, JobEventType, JobPriority } from '@prisma/client';
import {
  STORAGE_SERVICE,
  type IStorageService,
} from '../../storage/storage.service.js';

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
        source: dto.source,
        notes: dto.notes,
        appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : undefined,
        nextInterviewAt: dto.nextInterviewAt
          ? new Date(dto.nextInterviewAt)
          : undefined,
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
    return job;
  }

  // Shared filter builder for the list and CSV export — both expose the same
  // status/priority/search/date filters scoped to the owner.
  private buildJobWhere(userId: string, query: JobQueryDto) {
    const { status, priority, search, dateFrom, dateTo } = query;
    return {
      userId,
      ...(status && { status }),
      ...(priority && { priority }),
      ...(search && {
        OR: [
          { company: { contains: search, mode: 'insensitive' as const } },
          { position: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(dateFrom || dateTo
        ? {
            appliedAt: {
              ...(dateFrom && { gte: new Date(dateFrom) }),
              ...(dateTo && { lte: new Date(dateTo) }),
            },
          }
        : {}),
    };
  }

  async findAll(userId: string, query: JobQueryDto) {
    const {
      page = 1,
      limit = 10,
      sortBy = 'appliedAt',
      sortOrder = 'desc',
    } = query;

    const where = this.buildJobWhere(userId, query);

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
      include: { companyProfile: true, resume: true },
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

  async update(userId: string, jobId: string, dto: UpdateJobDto) {
    const existing = await this.findOwned(userId, jobId);

    const statusChanged = dto.status && dto.status !== existing.status;

    return this.prisma.job.update({
      where: { id: jobId },
      include: { companyProfile: true, resume: true },
      data: {
        company: dto.company,
        position: dto.position,
        location: dto.location,
        url: dto.url,
        status: dto.status,
        priority: dto.priority,
        source: dto.source,
        notes: dto.notes,
        appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : undefined,
        nextInterviewAt:
          dto.nextInterviewAt !== undefined
            ? dto.nextInterviewAt
              ? new Date(dto.nextInterviewAt)
              : null
            : undefined,
        ...(statusChanged && {
          events: {
            create: {
              type: JobEventType.STATUS_CHANGE,
              fromStatus: existing.status,
              toStatus: dto.status!,
            },
          },
        }),
      },
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

  async getStats(userId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [counts, total, thisMonth] = await Promise.all([
      this.prisma.job.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
      this.prisma.job.count({ where: { userId } }),
      this.prisma.job.count({
        where: { userId, appliedAt: { gte: startOfMonth } },
      }),
    ]);

    const byStatus = Object.values(JobStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<JobStatus, number>,
    );
    for (const row of counts) byStatus[row.status] = row._count._all;

    // responseRate = (INTERVIEWING + OFFER + REJECTED) / total * 100, rounded to 1 dp
    const responded =
      byStatus[JobStatus.INTERVIEWING] +
      byStatus[JobStatus.OFFER] +
      byStatus[JobStatus.REJECTED];
    const responseRate =
      total > 0 ? Math.round((responded / total) * 1000) / 10 : 0;

    return { total, byStatus, thisMonth, responseRate };
  }

  // "Needs attention" heuristics — computed from existing fields, no stored state:
  // interviews within 48h, INTERVIEWING jobs with no event for 5 days, and
  // APPLIED jobs with no movement for 7 days.
  async getAttention(userId: string) {
    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [upcoming, staleInterviewing, staleApplied] = await Promise.all([
      this.prisma.job.findMany({
        where: { userId, nextInterviewAt: { gte: now, lte: in48h } },
        orderBy: { nextInterviewAt: 'asc' },
      }),
      this.prisma.job.findMany({
        where: {
          userId,
          status: JobStatus.INTERVIEWING,
          events: { none: { createdAt: { gt: fiveDaysAgo } } },
        },
        include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.job.findMany({
        where: {
          userId,
          status: JobStatus.APPLIED,
          appliedAt: { lt: sevenDaysAgo },
        },
        orderBy: { appliedAt: 'asc' },
      }),
    ]);

    const items = [
      ...upcoming.map((job) => ({
        type: 'UPCOMING_INTERVIEW' as const,
        since: job.nextInterviewAt!,
        job,
      })),
      ...staleInterviewing.map(({ events, ...job }) => ({
        type: 'STALE_INTERVIEWING' as const,
        since: events[0]?.createdAt ?? job.updatedAt,
        job,
      })),
      ...staleApplied.map((job) => ({
        type: 'STALE_APPLIED' as const,
        since: job.appliedAt,
        job,
      })),
    ];

    // A job can match several rules — keep only its highest-priority reason
    // (array order above is the priority order)
    const seen = new Set<string>();
    return items.filter((item) => {
      if (seen.has(item.job.id)) return false;
      seen.add(item.job.id);
      return true;
    });
  }

  async exportCsv(userId: string, query: JobQueryDto) {
    const where = this.buildJobWhere(userId, query);
    const exportLimit = 1_000;

    const jobs = await this.prisma.job.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
      take: exportLimit + 1,
    });
    const truncated = jobs.length > exportLimit;
    if (truncated) jobs.length = exportLimit;

    // Prefix a leading ' on formula-trigger characters so Excel/Sheets treat
    // the cell as literal text instead of evaluating it (CSV/formula injection).
    const escape = (v: string | null | undefined) => {
      const s = v ?? '';
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${safe.replace(/"/g, '""')}"`;
    };

    const headers = [
      'Company',
      'Position',
      'Status',
      'Source',
      'Location',
      'Applied Date',
      'Next Interview',
      'URL',
      'Notes',
    ].join(',');

    const rows = jobs.map((j) =>
      [
        escape(j.company),
        escape(j.position),
        escape(j.status),
        escape(j.source),
        escape(j.location),
        escape(j.appliedAt.toISOString().split('T')[0]),
        escape(j.nextInterviewAt?.toISOString().split('T')[0]),
        escape(j.url),
        escape(j.notes),
      ].join(','),
    );

    return { csv: [headers, ...rows].join('\r\n'), truncated };
  }
}
