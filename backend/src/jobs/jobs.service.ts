import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { JobStatus, JobEventType } from '@prisma/client';

@Injectable()
export class JobsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateJobDto) {
    const initialStatus = dto.status ?? JobStatus.APPLIED;
    return this.prisma.job.create({
      data: {
        company: dto.company,
        position: dto.position,
        location: dto.location,
        url: dto.url || undefined,
        status: initialStatus,
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
  }

  async findAll(userId: string, query: JobQueryDto) {
    const {
      status,
      search,
      page = 1,
      limit = 10,
      sortBy = 'appliedAt',
      sortOrder = 'desc',
      dateFrom,
      dateTo,
    } = query;

    const where = {
      userId,
      ...(status && { status }),
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
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.userId !== userId) throw new ForbiddenException();
    return job;
  }

  async update(userId: string, jobId: string, dto: UpdateJobDto) {
    const existing = await this.findOne(userId, jobId);

    const statusChanged = dto.status && dto.status !== existing.status;

    return this.prisma.job.update({
      where: { id: jobId },
      data: {
        company: dto.company,
        position: dto.position,
        location: dto.location,
        url: dto.url,
        status: dto.status,
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
    await this.findOne(userId, jobId);
    await this.prisma.job.delete({ where: { id: jobId } });
    return { message: 'Job deleted' };
  }

  async getEvents(userId: string, jobId: string) {
    await this.findOne(userId, jobId);
    return this.prisma.jobEvent.findMany({
      where: { jobId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStats(userId: string) {
    const jobs = await this.prisma.job.findMany({
      where: { userId },
      select: { status: true, appliedAt: true },
    });

    const byStatus = Object.values(JobStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<JobStatus, number>,
    );
    for (const job of jobs) byStatus[job.status]++;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = jobs.filter((j) => j.appliedAt >= startOfMonth).length;

    const responded =
      byStatus[JobStatus.INTERVIEWING] +
      byStatus[JobStatus.OFFER] +
      byStatus[JobStatus.REJECTED];
    const responseRate =
      jobs.length > 0
        ? Math.round((responded / jobs.length) * 1000) / 10
        : 0;

    return { total: jobs.length, byStatus, thisMonth, responseRate };
  }

  async exportCsv(userId: string, query: JobQueryDto) {
    const { status, search, dateFrom, dateTo } = query;

    const where = {
      userId,
      ...(status && { status }),
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

    const jobs = await this.prisma.job.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
    });

    const escape = (v: string | null | undefined) =>
      `"${(v ?? '').replace(/"/g, '""')}"`;

    const headers = [
      'Company',
      'Position',
      'Status',
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
        escape(j.location),
        escape(j.appliedAt.toISOString().split('T')[0]),
        escape(j.nextInterviewAt?.toISOString().split('T')[0]),
        escape(j.url),
        escape(j.notes),
      ].join(','),
    );

    return [headers, ...rows].join('\r\n');
  }
}
