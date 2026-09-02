import { JobStatus } from '@prisma/client';
import { JobQueryDto } from './dto/job-query.dto.js';
import {
  localCivilDay,
  safeTimeZone,
  zonedInstantFromCivil,
} from '../../common/timezone.util.js';

export const FUNNEL_STAGES = [
  JobStatus.WISHLIST,
  JobStatus.APPLIED,
  JobStatus.INTERVIEWING,
  JobStatus.OFFER,
] as const;

export const DROPOFF_STAGES = [JobStatus.REJECTED, JobStatus.GHOSTED] as const;

// Compile-time guard: every JobStatus must appear in FUNNEL_STAGES or
// DROPOFF_STAGES. If this fails to compile, a newly added JobStatus is
// missing from one of the two arrays above — the type error names it.
type UncoveredStages = Exclude<
  JobStatus,
  (typeof FUNNEL_STAGES)[number] | (typeof DROPOFF_STAGES)[number]
>;
const _allStagesCovered: UncoveredStages extends never
  ? true
  : [uncovered: UncoveredStages] = true;
void _allStagesCovered;

// A WISHLIST job is saved-for-later — never applied to — but `Job.appliedAt`
// is `@default(now())`, so it still carries a date and lands in every
// appliedAt-scoped metric unless excluded on purpose. Every stat that means
// "applications sent" (total, thisMonth, the response/ghost-rate denominator,
// trend volume, per-channel response rate) spreads this. Centralized so those
// call sites can't drift apart on what counts as an application.
//
// `byStatus` is the deliberate exception: the status pie chart renders a
// Wishlist slice, so it groups over every status. That makes
// sum(byStatus) >= total by design whenever wishlist jobs exist.
export const SENT_APPLICATION_FILTER = {
  status: { not: JobStatus.WISHLIST },
} as const;

export const RESPONDED_STATUSES = [
  JobStatus.INTERVIEWING,
  JobStatus.OFFER,
  JobStatus.REJECTED,
] as const;

export function toPercent(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
}

export type StatsRange = '30d' | '90d' | 'all';

export const STATS_RANGES: StatsRange[] = ['30d', '90d', 'all'];

const RANGE_TO_DAYS: Partial<Record<StatsRange, number>> = {
  '30d': 30,
  '90d': 90,
};

// undefined cutoff = no lower bound (range: 'all')
export function rangeToCutoff(
  range: StatsRange,
  now: Date = new Date(),
): Date | undefined {
  const days = RANGE_TO_DAYS[range];
  if (days === undefined) return undefined;
  return new Date(now.getTime() - days * 86_400_000);
}

// Prisma where-fragment for scoping a query to `range` — `{}` (no lower
// bound) for 'all'. Centralized so getStats/getFunnel/getTrend can't drift
// apart on how a range is applied.
export function appliedAtRangeFilter(
  range: StatsRange,
  now: Date = new Date(),
): { appliedAt?: { gte: Date } } {
  const cutoff = rangeToCutoff(range, now);
  return cutoff ? { appliedAt: { gte: cutoff } } : {};
}

// `appliedAt` is a timestamp column, but `dateTo` is usually a date-only
// string from a <input type="date">. `new Date('2024-12-31')` is that day's
// midnight UTC, so a plain `lte` would exclude everything actually applied
// *during* the named day. Widen a date-only bound to an exclusive
// start-of-next-day instead; a caller who sends a full ISO datetime means
// that exact instant, so it stays an inclusive `lte`.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function appliedAtUpperBound(dateTo: string) {
  const parsed = new Date(dateTo);
  return DATE_ONLY.test(dateTo)
    ? { lt: new Date(parsed.getTime() + 86_400_000) }
    : { lte: parsed };
}

// Shared filter builder for the list and CSV export — both expose the same
// status/priority/search/date filters scoped to the owner.
export function buildJobWhere(userId: string, query: JobQueryDto) {
  const { status, statusIn, priority, search, dateFrom, dateTo } = query;
  // NFKC folds styled Unicode (e.g. Mathematical Bold letters pasted from
  // LinkedIn/social posts) down to plain Latin so `contains` can match
  // against normally-typed stored data.
  const normalizedSearch = search?.normalize('NFKC');
  // `statusIn` and `status` both write the same `status` key, so resolve them
  // in one expression — spreading both would silently drop whichever came
  // first. `statusIn` wins: it's the more specific of the two, and no caller
  // sends both.
  const statusFilter =
    statusIn && statusIn.length > 0
      ? { status: { in: statusIn } }
      : status
        ? { status }
        : {};
  return {
    userId,
    ...statusFilter,
    ...(priority && { priority }),
    ...(normalizedSearch && {
      // Widened past company/position to cover the two other free-text
      // columns — searching for a city or a note is the same intent, and
      // CSV export shares this builder so both stay consistent.
      OR: [
        {
          company: { contains: normalizedSearch, mode: 'insensitive' as const },
        },
        {
          position: {
            contains: normalizedSearch,
            mode: 'insensitive' as const,
          },
        },
        {
          location: {
            contains: normalizedSearch,
            mode: 'insensitive' as const,
          },
        },
        {
          notes: { contains: normalizedSearch, mode: 'insensitive' as const },
        },
      ],
    }),
    ...(dateFrom || dateTo
      ? {
          appliedAt: {
            ...(dateFrom && { gte: new Date(dateFrom) }),
            ...(dateTo && appliedAtUpperBound(dateTo)),
          },
        }
      : {}),
  };
}

// `Job.nextInterviewAt` is denormalized: InterviewRoundsService recomputes it
// from the earliest future PENDING round on every round write, but nothing
// touches it when time simply passes. Once the stored instant is in the past
// it no longer names an *upcoming* interview, so read paths must not present
// it as one — otherwise the job detail page and the CSV export keep showing a
// date that has already been and gone. (getAttentionItems is already safe: it
// scopes its query with `gte: now`.)
export function upcomingInterviewAt(
  value: Date | null | undefined,
  now: Date = new Date(),
): Date | null {
  return value && value.getTime() >= now.getTime() ? value : null;
}

export type TrendGranularity = 'day' | 'week' | 'month';

export interface TrendBucket {
  label: string;
  periodStart: string;
  count: number;
  cumulative: number;
}

export function rangeToGranularity(range: StatsRange): TrendGranularity {
  if (range === '30d') return 'day';
  if (range === '90d') return 'week';
  return 'month';
}

// The three helpers below all operate on *civil* dates — wall-clock days
// encoded as UTC midnight (see common/timezone.util.ts). Everything is UTC
// arithmetic on purpose: the calendar has already been resolved in the
// user's zone, so a DST shift must not move a bucket boundary here.
function startOfPeriod(civil: Date, granularity: TrendGranularity): Date {
  const d = new Date(
    Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth(), civil.getUTCDate()),
  );
  if (granularity === 'day') return d;
  if (granularity === 'week') {
    const daysSinceMonday = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - daysSinceMonday);
    return d;
  }
  return new Date(Date.UTC(civil.getUTCFullYear(), civil.getUTCMonth(), 1));
}

function nextPeriod(civil: Date, granularity: TrendGranularity): Date {
  const d = new Date(civil);
  if (granularity === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (granularity === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

function formatLabel(civil: Date, granularity: TrendGranularity): string {
  // timeZone: 'UTC' reads the civil encoding back literally — without it the
  // label would be re-projected into the *server's* zone and could name the
  // day before the bucket it sits on.
  if (granularity === 'month') {
    return civil.toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      year: 'numeric',
    });
  }
  return civil.toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}

// Pure function, unit-testable without Prisma mocking. `appliedDates` must
// already be scoped to the same user + range filter as the caller's other
// stats queries, so `cumulative` at the last bucket lines up with getStats's
// range-filtered total.
//
// `timeZone` is the *user's* IANA zone, not the server's. Bucketing on the
// server's calendar put a UTC+5 user's late-evening application on the
// following day's bar (and, at a month boundary, in a bucket their own
// "this month" card disagreed with). Defaults to UTC so the pure-function
// callers in tests stay deterministic on any machine.
export function computeTrendBuckets(
  appliedDates: Date[],
  range: StatsRange,
  now: Date = new Date(),
  timeZone = 'UTC',
): { granularity: TrendGranularity; buckets: TrendBucket[] } {
  const tz = safeTimeZone(timeZone);
  const granularity = rangeToGranularity(range);
  const cutoff = rangeToCutoff(range, now);

  if (appliedDates.length === 0) {
    // No applications at all (in range) — match StatusChart/FunnelChart's
    // empty-state convention rather than rendering an all-zero chart.
    return { granularity, buckets: [] };
  }

  // Resolve every instant to the user's calendar day *first*; all bucket
  // arithmetic below is then civil-date arithmetic.
  const sorted = appliedDates
    .map((applied) => localCivilDay(applied, tz))
    .sort((a, b) => a.getTime() - b.getTime());
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const nowCivil = localCivilDay(now, tz);
  const windowStart = startOfPeriod(
    cutoff ? localCivilDay(cutoff, tz) : earliest,
    granularity,
  );
  // Anchor the window end to whichever is later — today or the latest applied
  // date — so a future-dated appliedAt still gets its own bucket instead of
  // silently falling outside [windowStart, windowEndExclusive) and vanishing.
  const windowEndAnchor =
    latest.getTime() > nowCivil.getTime() ? latest : nowCivil;
  const windowEndExclusive = nextPeriod(
    startOfPeriod(windowEndAnchor, granularity),
    granularity,
  );

  const counts = new Map<number, number>();
  for (const applied of sorted) {
    const key = startOfPeriod(applied, granularity).getTime();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const buckets: TrendBucket[] = [];
  let cumulative = 0;
  for (
    let cursor = windowStart;
    cursor.getTime() < windowEndExclusive.getTime();
    cursor = nextPeriod(cursor, granularity)
  ) {
    const count = counts.get(cursor.getTime()) ?? 0;
    cumulative += count;
    buckets.push({
      label: formatLabel(cursor, granularity),
      // A real instant, not the civil encoding — the period start as it
      // actually happened for this user, so a client that re-formats it
      // gets the same day back.
      periodStart: zonedInstantFromCivil(cursor.getTime(), tz).toISOString(),
      count,
      cumulative,
    });
  }

  return { granularity, buckets };
}
