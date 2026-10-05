'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Briefcase,
  TrendingUp,
  Award,
  BarChart2,
  CalendarDays,
  Ghost,
} from 'lucide-react';
import { AttentionCard } from '../../components/dashboard/attention-card';
import { GhostSuggestionsCard } from '../../components/dashboard/ghost-suggestions-card';
import { StatsCard } from '../../components/dashboard/stats-card';
import { WelcomeCard } from '../../components/dashboard/welcome-card';
import {
  ChartCard,
  ChartSkeleton,
  FUNNEL_SKELETON_CLASS,
} from '../../components/dashboard/chart-card';
import { DateRangeSelect } from '../../components/dashboard/date-range-select';
import { Skeleton, LoadingStatus } from '../../components/ui/skeleton';
import { StatusBadge } from '../../components/ui/badge';
import { formatCivilDate, humanizeIsoDates } from '../../lib/utils';
import type { DashboardRange } from '../../types';
import {
  useStatsQuery,
  useFunnelQuery,
  useTrendQuery,
  useRecentJobsQuery,
} from '../../features/dashboard/hooks';
import { PageHeader } from '../../components/layout/page-header';

/**
 * Status donut chart, loaded on the client only.
 *
 * Charts are code-split out of the initial dashboard bundle. The page renders
 * them straight away, each showing a skeleton until its data arrives, so the
 * chunk loads alongside the API calls rather than after them. All three point
 * at the same module so Turbopack resolves the shared Recharts vendor
 * dependency once instead of duplicating it across three chunks.
 */
const StatusChart = dynamic(
  () =>
    import('../../components/dashboard/dashboard-charts').then(
      (m) => m.StatusChartPanel,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);
/** Funnel chart, loaded on the client only. */
const FunnelChart = dynamic(
  () =>
    import('../../components/dashboard/dashboard-charts').then(
      (m) => m.FunnelChartPanel,
    ),
  {
    ssr: false,
    loading: () => <ChartSkeleton className={FUNNEL_SKELETON_CLASS} />,
  },
);
/** Trend chart, loaded on the client only. */
const TrendChart = dynamic(
  () =>
    import('../../components/dashboard/dashboard-charts').then(
      (m) => m.TrendChartPanel,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

/**
 * Dashboard (`/`): headline stats, needs attention, looks ghosted, charts and
 * recent activity for the chosen range.
 */
export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('all');

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useStatsQuery(range);

  const { data: funnel, isError: funnelError } = useFunnelQuery(range);

  const { data: trend, isError: trendError } = useTrendQuery(range);

  const {
    data: recent,
    isLoading: recentLoading,
    isError: recentError,
  } = useRecentJobsQuery();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Your job search at a glance"
        actions={<DateRangeSelect value={range} onChange={setRange} />}
      />

      {recent?.data.length === 0 && <WelcomeCard />}

      {/* What to act on comes before how the search is going. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AttentionCard />
        <GhostSuggestionsCard />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-6">
        <StatsCard
          label="Applications Sent"
          value={stats?.total ?? '—'}
          icon={<Briefcase className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="This Month"
          value={stats?.thisMonth ?? '—'}
          icon={<CalendarDays className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="Interviewing"
          value={stats?.byStatus.INTERVIEWING ?? '—'}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="Offers"
          value={stats?.byStatus.OFFER ?? '—'}
          icon={<Award className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="Response Rate"
          value={stats ? `${stats.responseRate}%` : '—'}
          sub="Heard back at all"
          icon={<BarChart2 className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="Ghost Rate"
          value={stats ? `${stats.ghostRate}%` : '—'}
          sub="Marked ghosted"
          icon={<Ghost className="h-4 w-4" />}
          loading={statsLoading}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Applications by Status"
          error={statsError && !stats}
          errorMessage="Failed to load chart."
        >
          <StatusChart stats={stats} />
        </ChartCard>

        <div className="rounded-md border border-line bg-paper p-5">
          <h2 className="mb-4 text-sm font-semibold text-ink">
            Recent Activity
          </h2>
          {recentLoading ? (
            <LoadingStatus
              label="Loading recent activity"
              className="space-y-3"
            >
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </LoadingStatus>
          ) : recentError && !recent ? (
            <p className="text-sm text-danger">Failed to load recent jobs.</p>
          ) : recent?.data.length === 0 ? (
            // No link here: WelcomeCard, shown whenever this list is empty,
            // already leads with adding the first job.
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-sm text-muted-2">No jobs tracked yet.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {recent?.data.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {job.company}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {job.position}
                    </p>
                    {job.timelineSummary && (
                      <p className="truncate text-xs text-muted-2">
                        {humanizeIsoDates(job.timelineSummary)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={job.status} />
                    <span className="text-xs text-muted-2">
                      {formatCivilDate(job.appliedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ChartCard
        title="Application Funnel"
        error={funnelError && !funnel}
        errorMessage="Failed to load funnel."
      >
        <FunnelChart data={funnel} />
      </ChartCard>

      <ChartCard
        title="Applications Over Time"
        error={trendError && !trend}
        errorMessage="Failed to load trend."
      >
        <TrendChart data={trend} />
      </ChartCard>
    </div>
  );
}
