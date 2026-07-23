import { JobStatus } from '@prisma/client';

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
export function rangeToCutoff(range: StatsRange): Date | undefined {
  const days = RANGE_TO_DAYS[range];
  if (days === undefined) return undefined;
  return new Date(Date.now() - days * 86_400_000);
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

function startOfPeriod(date: Date, granularity: TrendGranularity): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (granularity === 'day') return d;
  if (granularity === 'week') {
    const daysSinceMonday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - daysSinceMonday);
    return d;
  }
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function nextPeriod(date: Date, granularity: TrendGranularity): Date {
  const d = new Date(date);
  if (granularity === 'day') d.setDate(d.getDate() + 1);
  else if (granularity === 'week') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d;
}

function formatLabel(date: Date, granularity: TrendGranularity): string {
  if (granularity === 'month') {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      year: 'numeric',
    });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Pure function, unit-testable without Prisma mocking. `appliedDates` must
// already be scoped to the same user + range filter as the caller's other
// stats queries, so `cumulative` at the last bucket lines up with getStats's
// range-filtered total.
export function computeTrendBuckets(
  appliedDates: Date[],
  range: StatsRange,
  now: Date = new Date(),
): { granularity: TrendGranularity; buckets: TrendBucket[] } {
  const granularity = rangeToGranularity(range);
  const cutoff = rangeToCutoff(range);

  if (appliedDates.length === 0) {
    // No applications at all (in range) — match StatusChart/FunnelChart's
    // empty-state convention rather than rendering an all-zero chart.
    return { granularity, buckets: [] };
  }

  const sorted = [...appliedDates].sort((a, b) => a.getTime() - b.getTime());
  const earliest = sorted[0];
  const windowStart = startOfPeriod(cutoff ?? earliest, granularity);
  const windowEndExclusive = nextPeriod(startOfPeriod(now, granularity), granularity);

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
      periodStart: cursor.toISOString(),
      count,
      cumulative,
    });
  }

  return { granularity, buckets };
}
