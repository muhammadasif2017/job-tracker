'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Briefcase, TrendingUp, Award, BarChart2, CalendarDays, Ghost } from 'lucide-react';
import Link from 'next/link';
import { AttentionCard } from '../../components/dashboard/attention-card';
import { StatsCard } from '../../components/dashboard/stats-card';
import { ChartCard } from '../../components/dashboard/chart-card';
import { DateRangeSelect } from '../../components/dashboard/date-range-select';
import { Skeleton } from '../../components/ui/skeleton';
import { StatusBadge } from '../../components/ui/badge';
import { formatDateOnly } from '../../lib/utils';
import type { DashboardRange } from '../../types';
import {
  useStatsQuery,
  useFunnelQuery,
  useTrendQuery,
  useRecentJobsQuery,
} from '../../features/dashboard/hooks';

// Charts: code-split out of the initial dashboard bundle, gated behind their queries anyway.
const StatusChart = dynamic(
  () => import('../../components/dashboard/status-chart').then((m) => m.StatusChart),
  { ssr: false },
);
const FunnelChart = dynamic(
  () => import('../../components/dashboard/funnel-chart').then((m) => m.FunnelChart),
  { ssr: false },
);
const TrendChart = dynamic(
  () => import('../../components/dashboard/trend-chart').then((m) => m.TrendChart),
  { ssr: false },
);

export default function DashboardPage() {
  const [range, setRange] = useState<DashboardRange>('90d');

  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useStatsQuery(range);

  const {
    data: funnel,
    isLoading: funnelLoading,
    isError: funnelError,
  } = useFunnelQuery(range);

  const {
    data: trend,
    isLoading: trendLoading,
    isError: trendError,
  } = useTrendQuery(range);

  const {
    data: recent,
    isLoading: recentLoading,
    isError: recentError,
  } = useRecentJobsQuery();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-slate-500">Your job search at a glance</p>
        </div>
        <DateRangeSelect value={range} onChange={setRange} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <StatsCard
          label="Total Applications"
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
          sub="Interviewing + offers + rejected"
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

      <AttentionCard />

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard
          title="Applications by Status"
          loading={statsLoading}
          error={statsError && !stats}
          errorMessage="Failed to load chart."
        >
          {stats && <StatusChart stats={stats} />}
        </ChartCard>

        <div className="rounded-xl border bg-white p-5 dark:bg-slate-900">
          <h2 className="mb-4 text-sm font-semibold">Recent Activity</h2>
          {recentLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentError && !recent ? (
            <p className="text-sm text-red-500">Failed to load recent jobs.</p>
          ) : recent?.data.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <p className="text-sm text-slate-400">No jobs tracked yet.</p>
              <Link
                href="/jobs"
                className="mt-2 text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                Add your first application →
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {recent?.data.map((job) => (
                <li
                  key={job.id}
                  className="flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {job.company}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {job.position}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={job.status} />
                    <span className="text-xs text-slate-400">
                      {formatDateOnly(job.appliedAt)}
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
        loading={funnelLoading}
        error={funnelError && !funnel}
        errorMessage="Failed to load funnel."
        skeletonClassName="h-[420px] w-full"
      >
        {funnel && <FunnelChart data={funnel} />}
      </ChartCard>

      <ChartCard
        title="Applications Over Time"
        loading={trendLoading}
        error={trendError && !trend}
        errorMessage="Failed to load trend."
      >
        {trend && <TrendChart data={trend} />}
      </ChartCard>
    </div>
  );
}
