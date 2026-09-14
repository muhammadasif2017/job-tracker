import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { getAttentionItems } from './attention.helper.js';
import type { AttentionType } from './dto/attention-item.dto.js';
import {
  buildGhostSuggestionWhere,
  getGhostSuggestions,
  ghostCutoff,
  GHOST_AFTER_DAYS,
} from './ghost-suggestions.helper.js';
import {
  JobStatus,
  ApplicationChannel,
  DiscoverySource,
  JobEventType,
} from '@prisma/client';
import {
  localCivilDay,
  safeTimeZone,
  startOfCivilMonth,
} from '../../common/timezone.util.js';
import {
  FUNNEL_STAGES,
  DROPOFF_STAGES,
  REPLIED_FILTER,
  RESPONDED_STATUSES,
  toPercent,
  type StatsRange,
  appliedAtRangeFilter,
  computeTrendBuckets,
  buildJobWhere,
  SENT_APPLICATION_FILTER,
  upcomingInterviewAt,
} from './jobs.constants.js';

// The calendar day a real instant falls on for this user, or null. Kept
// separate from `localCivilDay` so the nullable read paths don't each repeat
// the guard.
function civilDay(value: Date | null, timeZone: string): Date | null {
  return value ? localCivilDay(value, timeZone) : null;
}

type SourceCountRow = {
  applicationChannel: ApplicationChannel | null;
  discoverySource: DiscoverySource | null;
  _count: { _all: number };
};

// Folds the (channel, discovery source) group counts down to one of the two
// fields. A null field is its own UNSPECIFIED bucket rather than dropped, so
// untagged applications still show how often they get replies.
function rateBy<F extends 'applicationChannel' | 'discoverySource'>(
  field: F,
  sent: SourceCountRow[],
  replied: SourceCountRow[],
) {
  type Source = NonNullable<SourceCountRow[F]> | 'UNSPECIFIED';
  const buckets = new Map<Source, { total: number; replied: number }>();
  const bucket = (row: SourceCountRow) => {
    const key: Source = row[field] ?? 'UNSPECIFIED';
    let entry = buckets.get(key);
    if (!entry) buckets.set(key, (entry = { total: 0, replied: 0 }));
    return entry;
  };
  for (const row of sent) bucket(row).total += row._count._all;
  for (const row of replied) bucket(row).replied += row._count._all;
  return Array.from(buckets, ([source, { total, replied }]) => ({
    source,
    total,
    responseRate: toPercent(replied, total),
  }));
}

// How long companies take to reply (docs/specs/response-insights.md): days
// from appliedAt to a job's first stage-entry event into a replied status.
// `stageEntries` must hold only CREATED/STATUS_CHANGE events, oldest first —
// INTERVIEW_ROUND_ADDED carries the current status and would fake a reply.
//
// A job whose *first* event is already a replied status was added after the
// fact (e.g. created straight as REJECTED): that timestamp is when the row was
// entered, not when the company answered, so it has no usable reply date and is
// left out of the timing — it still counts as replied in the response rates.
//
// repliedAfter14DaysPercent is measured against GHOST_AFTER_DAYS, so it shows
// how many real replies the "looks ghosted" cutoff would have flagged early.
function computeReplyTiming(
  sentJobs: { id: string; appliedAt: Date }[],
  stageEntries: Map<string, { toStatus: JobStatus; createdAt: Date }[]>,
) {
  const isReply = (status: JobStatus) =>
    (RESPONDED_STATUSES as readonly JobStatus[]).includes(status);

  const days: number[] = [];
  for (const job of sentJobs) {
    const entries = stageEntries.get(job.id) ?? [];
    const firstReply = entries.findIndex((e) => isReply(e.toStatus));
    if (firstReply <= 0) continue; // never replied, or no real reply date
    const ms =
      entries[firstReply].createdAt.getTime() - job.appliedAt.getTime();
    // appliedAt is a civil date (UTC midnight), so a same-day reply can land
    // a few hours "before" it for users west of UTC — clamp to zero.
    days.push(Math.max(0, ms) / 86_400_000);
  }

  if (days.length === 0) {
    return { repliedCount: 0, medianDays: null, repliedAfter14DaysPercent: 0 };
  }
  days.sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median =
    days.length % 2 === 1 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return {
    repliedCount: days.length,
    medianDays: Math.round(median * 10) / 10,
    repliedAfter14DaysPercent: toPercent(
      days.filter((d) => d > GHOST_AFTER_DAYS).length,
      days.length,
    ),
  };
}

@Injectable()
export class JobsStatsService {
  constructor(private prisma: PrismaService) {}

  // `Job.appliedAt` is a civil date (ADR-034), so no stat projects a stored
  // value into a zone — that would shift it. The zone is needed only to place
  // a *boundary* on the user's calendar: which month is "this" month, and
  // which day a rolling 30d/90d window starts on. Same `User.timezone` the
  // digest/reminder emails honour; read per request rather than off the JWT
  // so it's correct right after the user changes it in their profile. Missing
  // row (or a hand-edited invalid zone) falls back to UTC, the column default.
  private async userTimeZone(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { timezone: true },
    });
    return safeTimeZone(user?.timezone);
  }

  async getStats(userId: string, range: StatsRange) {
    const now = new Date();
    // The zone has to be resolved before the range filter can be built, so
    // this one round-trip is unavoidably on the critical path of a
    // dashboard-mount request. It's a primary-key lookup on one column.
    const timeZone = await this.userTimeZone(userId);
    // thisMonth is always "applications this calendar month" — not scoped by `range`.
    const rangeWhere = {
      userId,
      ...appliedAtRangeFilter(range, now, timeZone),
    };

    const [counts, total, thisMonth, replied] = await Promise.all([
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
          appliedAt: { gte: startOfCivilMonth(now, timeZone) },
          ...SENT_APPLICATION_FILTER,
        },
      }),
      // Ever replied, from the event history — see REPLIED_FILTER. Not derived
      // from byStatus, which only knows where each job is now.
      this.prisma.job.count({
        where: { ...rangeWhere, ...SENT_APPLICATION_FILTER, ...REPLIED_FILTER },
      }),
    ]);

    const byStatus = Object.values(JobStatus).reduce(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {} as Record<JobStatus, number>,
    );
    for (const row of counts) byStatus[row.status] = row._count._all;

    // Can exceed 100% combined with ghostRate: a job can reply, then go ghosted.
    const responseRate = toPercent(replied, total);
    const ghostRate = toPercent(byStatus[JobStatus.GHOSTED], total);

    return { total, byStatus, thisMonth, responseRate, ghostRate };
  }

  async getFunnel(userId: string, range: StatsRange) {
    const TRACKED_STAGES = [...FUNNEL_STAGES, ...DROPOFF_STAGES] as const;
    // Filtered on the job's appliedAt, not event createdAt — a job either
    // belongs to the range or it doesn't; its full event history still counts.
    const jobRangeFilter = appliedAtRangeFilter(
      range,
      new Date(),
      await this.userTimeZone(userId),
    );

    const sentWhere = {
      userId,
      ...SENT_APPLICATION_FILTER,
      ...jobRangeFilter,
    };
    const [events, sentBySource, repliedBySource, sentJobs] = await Promise.all(
      [
        // No upper bound on event history — acceptable at this app's scale
        // (one user's own job search), but this becomes the slowest query on
        // the page if event volume per user ever grows much larger.
        this.prisma.jobEvent.findMany({
          where: { job: { userId, ...jobRangeFilter } },
          select: { jobId: true, type: true, toStatus: true, createdAt: true },
          orderBy: [{ jobId: 'asc' }, { createdAt: 'asc' }],
        }),
        // Per-source response rates: every sent application (WISHLIST excluded —
        // a rate over applications sent, not jobs saved for later), then only
        // the ones that ever replied. Grouped by both source fields at once so
        // one pair of queries serves both breakdowns. REPLIED_FILTER is the same
        // "ever replied" rule getStats.responseRate uses, so the headline rate
        // and the per-source rates agree about what a reply is.
        this.prisma.job.groupBy({
          by: ['applicationChannel', 'discoverySource'],
          where: sentWhere,
          _count: { _all: true },
        }),
        this.prisma.job.groupBy({
          by: ['applicationChannel', 'discoverySource'],
          where: { ...sentWhere, ...REPLIED_FILTER },
          _count: { _all: true },
        }),
        // appliedAt per sent application — the start of the reply clock.
        this.prisma.job.findMany({
          where: sentWhere,
          select: { id: true, appliedAt: true },
        }),
      ],
    );

    // reached[stage] = distinct jobs whose event history ever hit that stage,
    // for funnel and dropoff stages alike.
    //
    // The two are NOT directly comparable, despite sharing this method: the
    // rollup below only walks the funnel spine, so a job created straight as
    // REJECTED counts in dropoff while never counting in the funnel it
    // supposedly dropped out of. Read dropoff as "ended here", not as a
    // remainder of the funnel.
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
    // stage before the job *left* it). Computed per job so one job's events
    // never leak into another's intervals.
    //
    // Only stage-entering events (CREATED / STATUS_CHANGE) open and close an
    // interval. INTERVIEW_ROUND_ADDED is written with `toStatus` set to the
    // job's *current* status (see InterviewRoundsService.logRoundEvent), so
    // treating it as a boundary chopped one stay in INTERVIEWING into one
    // short interval per round scheduled — and since each fragment counted
    // as its own sample, the average fell the more rounds a job actually
    // had. Filtering to status-entering events makes each interval a real
    // "entered stage X -> left for stage Y" span again.
    const isStageEntry = (type: JobEventType) =>
      type === JobEventType.CREATED || type === JobEventType.STATUS_CHANGE;
    const eventsByJob = new Map<string, typeof events>();
    for (const event of events) {
      if (!isStageEntry(event.type)) continue;
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

    // Channel is where the application went (portal, career email, HR);
    // discovery source is where the job was found (LinkedIn, Rozee, referral).
    const responseRateBySource = rateBy(
      'applicationChannel',
      sentBySource,
      repliedBySource,
    );
    const responseRateByDiscoverySource = rateBy(
      'discoverySource',
      sentBySource,
      repliedBySource,
    );

    const replyTiming = computeReplyTiming(sentJobs, eventsByJob);

    return {
      funnel,
      dropoff,
      avgTimeInStageDays,
      responseRateBySource,
      responseRateByDiscoverySource,
      replyTiming,
    };
  }

  async getTrend(userId: string, range: StatsRange) {
    // Same WISHLIST exclusion as getStats — the chart is labelled "New
    // applications", and `cumulative` at the last bucket is meant to line up
    // with getStats's range-filtered total (see computeTrendBuckets' contract).
    const now = new Date();
    const timeZone = await this.userTimeZone(userId);
    const jobs = await this.prisma.job.findMany({
      where: {
        userId,
        ...appliedAtRangeFilter(range, now, timeZone),
        ...SENT_APPLICATION_FILTER,
      },
      select: { appliedAt: true },
    });

    return computeTrendBuckets(
      jobs.map((j) => j.appliedAt),
      range,
      now,
      timeZone,
    );
  }

  async getGhostSuggestions(userId: string) {
    return getGhostSuggestions(this.prisma, userId);
  }

  // Dashboard "Needs Attention" only. The digest email calls getAttentionItems
  // directly and deliberately ignores both filters below.
  async getAttention(userId: string) {
    const items = await getAttentionItems(this.prisma, userId);
    const isStale = (type: AttentionType) => type !== 'UPCOMING_INTERVIEW';

    const staleJobIds = items
      .filter((item) => isStale(item.type))
      .map((item) => item.job.id);
    if (staleJobIds.length === 0) return items;

    const now = new Date();
    // A job the "Looks ghosted" card already shows would otherwise appear in
    // both cards. Only the stale jobs are checked, and only ids are loaded.
    const ghosted = await this.prisma.job.findMany({
      where: {
        ...buildGhostSuggestionWhere(userId, now),
        id: { in: staleJobIds },
      },
      select: { id: true },
    });
    const ghostedIds = new Set(ghosted.map((job) => job.id));
    const cutoff = ghostCutoff(now);

    return items.filter((item) => {
      if (!isStale(item.type)) return true;
      if (ghostedIds.has(item.job.id)) return false;
      // A dismissal ("HR said wait") also quiets the follow-up nudges.
      const dismissedAt = item.job.ghostSuggestionDismissedAt;
      return !dismissedAt || dismissedAt <= cutoff;
    });
  }

  async exportCsv(userId: string, query: JobQueryDto) {
    const where = buildJobWhere(userId, query);
    const exportLimit = 1_000;

    const [jobs, timeZone] = await Promise.all([
      this.prisma.job.findMany({
        where,
        orderBy: { appliedAt: 'desc' },
        take: exportLimit + 1,
      }),
      this.userTimeZone(userId),
    ]);
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
        // `appliedAt` is a civil date, so its UTC day *is* the calendar day
        // it names (ADR-034) — no projection.
        escape(j.appliedAt.toISOString().split('T')[0]),
        // `nextInterviewAt` is the opposite: a real instant. Taking its UTC
        // day would export a 02:00-local interview on the previous date for
        // a user ahead of UTC, so resolve it on their calendar first.
        escape(
          civilDay(upcomingInterviewAt(j.nextInterviewAt), timeZone)
            ?.toISOString()
            .split('T')[0],
        ),
        escape(j.url),
        escape(j.notes),
      ].join(','),
    );

    return { csv: [headers, ...rows].join('\r\n'), truncated };
  }
}
