import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { getAttentionItems } from './attention.helper.js';
import { JobStatus, ApplicationChannel } from '@prisma/client';
import {
  FUNNEL_STAGES,
  DROPOFF_STAGES,
  RESPONDED_STATUSES,
  toPercent,
  type StatsRange,
  appliedAtRangeFilter,
  computeTrendBuckets,
  buildJobWhere,
  SENT_APPLICATION_FILTER,
  upcomingInterviewAt,
} from './jobs.constants.js';

@Injectable()
export class JobsStatsService {
  constructor(private prisma: PrismaService) {}

  async getStats(userId: string, range: StatsRange) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // thisMonth is always "applications this calendar month" — not scoped by `range`.
    const rangeWhere = { userId, ...appliedAtRangeFilter(range) };

    const [counts, total, thisMonth] = await Promise.all([
      // byStatus alone keeps WISHLIST — it backs the status pie chart, which
      // renders a Wishlist slice. Every other number below is an
      // "applications sent" metric and excludes it.
      this.prisma.job.groupBy({
        by: ['status'],
        where: rangeWhere,
        _count: { _all: true },
      }),
      this.prisma.job.count({
        where: { ...rangeWhere, ...SENT_APPLICATION_FILTER },
      }),
      this.prisma.job.count({
        where: {
          userId,
          appliedAt: { gte: startOfMonth },
          ...SENT_APPLICATION_FILTER,
        },
      }),
    ]);

    const byStatus = Object.values(JobStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<JobStatus, number>,
    );
    for (const row of counts) byStatus[row.status] = row._count._all;

    const responded = RESPONDED_STATUSES.reduce(
      (sum, s) => sum + byStatus[s],
      0,
    );
    const responseRate = toPercent(responded, total);
    const ghostRate = toPercent(byStatus[JobStatus.GHOSTED], total);

    return { total, byStatus, thisMonth, responseRate, ghostRate };
  }

  async getFunnel(userId: string, range: StatsRange) {
    const TRACKED_STAGES = [...FUNNEL_STAGES, ...DROPOFF_STAGES] as const;
    // Filtered on the job's appliedAt, not event createdAt — a job either
    // belongs to the range or it doesn't; its full event history still counts.
    const jobRangeFilter = appliedAtRangeFilter(range);

    const [events, channelStatusCounts] = await Promise.all([
      // No upper bound on event history — acceptable at this app's scale
      // (one user's own job search), but this becomes the slowest query on
      // the page if event volume per user ever grows much larger.
      this.prisma.jobEvent.findMany({
        where: { job: { userId, ...jobRangeFilter } },
        select: { jobId: true, toStatus: true, createdAt: true },
        orderBy: [{ jobId: 'asc' }, { createdAt: 'asc' }],
      }),
      // Excludes WISHLIST: responseRateBySource is a rate over applications
      // sent, not jobs merely saved for later. Grouped by applicationChannel
      // (not discoverySource) — response rate is about the actual application
      // path, not where the job was first seen.
      this.prisma.job.groupBy({
        by: ['applicationChannel', 'status'],
        where: {
          userId,
          ...SENT_APPLICATION_FILTER,
          ...jobRangeFilter,
        },
        _count: { _all: true },
      }),
    ]);

    // reached[stage] = distinct jobs whose event history ever hit that stage
    // (funnel stages and dropoff stages alike — same "ever reached" method
    // for both, so dropoff and funnel numbers stay comparable).
    const reached: Record<string, Set<string>> = {};
    for (const s of TRACKED_STAGES) reached[s] = new Set();
    for (const event of events) {
      if ((TRACKED_STAGES as readonly JobStatus[]).includes(event.toStatus)) {
        reached[event.toStatus].add(event.jobId);
      }
    }

    // An event records only the stage a job *landed on*, never the ones it
    // passed through: a job created directly as OFFER, or dragged
    // APPLIED -> OFFER on the kanban board (whose columns let you skip
    // INTERVIEWING), writes one event for the destination and nothing else.
    // Without this rollup `reached` isn't monotonic — OFFER can out-count
    // APPLIED and the funnel bar renders upside down, with stage-to-stage
    // conversion above 100%.
    //
    // Done at read time over the sets rather than by backfilling synthetic
    // JobEvents: this also corrects rows already in the DB, and a synthetic
    // event would need an invented timestamp that would then feed
    // avgTimeInStageDays and corrupt a second metric. Union, not count
    // arithmetic, so a job that genuinely hit both APPLIED and OFFER is
    // still counted once.
    //
    // WISHLIST is deliberately outside the spine — it's an optional "saved
    // for later" pre-stage, not a step every application passes through, so
    // reaching APPLIED must not imply it. FUNNEL_STAGES being in funnel
    // order is load-bearing below; the compile-time guard in
    // jobs.constants.ts checks membership only, not ordering.
    const FUNNEL_SPINE = FUNNEL_STAGES.slice(
      FUNNEL_STAGES.indexOf(JobStatus.APPLIED),
    );
    for (let i = FUNNEL_SPINE.length - 1; i > 0; i--) {
      for (const jobId of reached[FUNNEL_SPINE[i]]) {
        reached[FUNNEL_SPINE[i - 1]].add(jobId);
      }
    }

    // stageDurationsMs[stage] = closed-interval gaps (ms spent in that funnel
    // stage before the job's next event). Computed per job so one job's
    // events never leak into another's intervals.
    const eventsByJob = new Map<string, typeof events>();
    for (const event of events) {
      const list = eventsByJob.get(event.jobId);
      if (list) list.push(event);
      else eventsByJob.set(event.jobId, [event]);
    }
    const stageDurationsMs: Record<string, number[]> = {};
    for (const jobEvents of eventsByJob.values()) {
      for (let i = 0; i < jobEvents.length - 1; i++) {
        const current = jobEvents[i];
        if (
          !(FUNNEL_STAGES as readonly JobStatus[]).includes(current.toStatus)
        ) {
          continue;
        }
        const next = jobEvents[i + 1];
        const durations = (stageDurationsMs[current.toStatus] ??= []);
        durations.push(next.createdAt.getTime() - current.createdAt.getTime());
      }
    }

    const funnel = FUNNEL_STAGES.map((status) => ({
      status,
      reached: reached[status].size,
    }));

    const avgTimeInStageDays: Partial<Record<JobStatus, number>> = {};
    for (const [status, durations] of Object.entries(stageDurationsMs)) {
      const avgMs = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      avgTimeInStageDays[status as JobStatus] =
        Math.round((avgMs / 86_400_000) * 10) / 10;
    }

    const dropoff = DROPOFF_STAGES.map((status) => ({
      status,
      count: reached[status].size,
    }));

    const bySource = new Map<string, { total: number; responded: number }>();
    for (const row of channelStatusCounts) {
      const key = row.applicationChannel ?? 'UNSPECIFIED';
      const entry = bySource.get(key) ?? { total: 0, responded: 0 };
      entry.total += row._count._all;
      if ((RESPONDED_STATUSES as readonly JobStatus[]).includes(row.status)) {
        entry.responded += row._count._all;
      }
      bySource.set(key, entry);
    }
    const responseRateBySource = Array.from(bySource.entries()).map(
      ([source, { total, responded }]) => ({
        source: source as ApplicationChannel | 'UNSPECIFIED',
        total,
        responseRate: toPercent(responded, total),
      }),
    );

    return { funnel, dropoff, avgTimeInStageDays, responseRateBySource };
  }

  async getTrend(userId: string, range: StatsRange) {
    // Same WISHLIST exclusion as getStats — the chart is labelled "New
    // applications", and `cumulative` at the last bucket is meant to line up
    // with getStats's range-filtered total (see computeTrendBuckets' contract).
    const jobs = await this.prisma.job.findMany({
      where: {
        userId,
        ...appliedAtRangeFilter(range),
        ...SENT_APPLICATION_FILTER,
      },
      select: { appliedAt: true },
    });

    return computeTrendBuckets(
      jobs.map((j) => j.appliedAt),
      range,
    );
  }

  async getAttention(userId: string) {
    return getAttentionItems(this.prisma, userId);
  }

  async exportCsv(userId: string, query: JobQueryDto) {
    const where = buildJobWhere(userId, query);
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
      'Discovery Source',
      'Application Channel',
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
        escape(j.discoverySource),
        escape(j.applicationChannel),
        escape(j.location),
        escape(j.appliedAt.toISOString().split('T')[0]),
        escape(
          upcomingInterviewAt(j.nextInterviewAt)?.toISOString().split('T')[0],
        ),
        escape(j.url),
        escape(j.notes),
      ].join(','),
    );

    return { csv: [headers, ...rows].join('\r\n'), truncated };
  }
}
