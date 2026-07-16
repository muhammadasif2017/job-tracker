'use client';

import { useQuery } from '@tanstack/react-query';
import { Briefcase, TrendingUp, Award, BarChart2 } from 'lucide-react';
import Link from 'next/link';
import { AttentionCard } from '../../components/dashboard/attention-card';
import { StatsCard } from '../../components/dashboard/stats-card';
import { StatusChart } from '../../components/dashboard/status-chart';
import { Skeleton } from '../../components/ui/skeleton';
import { StatusBadge } from '../../components/ui/badge';
import { formatDate } from '../../lib/utils';
import api from '../../lib/api';
import type { JobStats, PaginatedJobs } from '../../types';

export default function DashboardPage() {
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
  } = useQuery<JobStats>({
    queryKey: ['stats'],
    queryFn: () => api.get('/jobs/stats').then((r) => r.data),
  });

  const {
    data: recent,
    isLoading: recentLoading,
    isError: recentError,
  } = useQuery<PaginatedJobs>({
    queryKey: ['jobs', { limit: 5, sortBy: 'createdAt' }],
    queryFn: () =>
      api
        .get('/jobs?limit=5&sortBy=createdAt&sortOrder=desc')
        .then((r) => r.data),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">Your job search at a glance</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          label="Total Applications"
          value={stats?.total ?? 0}
          icon={<Briefcase className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="Interviewing"
          value={stats?.byStatus.INTERVIEWING ?? 0}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={statsLoading}
        />
        <StatsCard
          label="Offers"
          value={stats?.byStatus.OFFER ?? 0}
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
      </div>

      <AttentionCard />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5 dark:bg-slate-900">
          <h2 className="mb-4 text-sm font-semibold">Applications by Status</h2>
          {statsLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : statsError ? (
            <p className="text-sm text-red-500">Failed to load chart.</p>
          ) : (
            stats && <StatusChart stats={stats} />
          )}
        </div>

        <div className="rounded-xl border bg-white p-5 dark:bg-slate-900">
          <h2 className="mb-4 text-sm font-semibold">Recent Activity</h2>
          {recentLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : recentError ? (
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
                      {formatDate(job.appliedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
