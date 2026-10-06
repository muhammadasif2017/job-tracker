// Single entry point for all three dashboard charts, so the three
// next/dynamic() call sites in app/(dashboard)/page.tsx resolve to one
// shared chunk instead of each pulling its own copy of the Recharts vendor bundle.
import type { FunnelStats, JobStats, TrendStats } from '../../types';
import { ChartSkeleton, FUNNEL_SKELETON_CLASS } from './chart-card';
import { StatusChart } from './status-chart';
import { FunnelChart } from './funnel-chart';
import { TrendChart } from './trend-chart';

/**
 * The status chart, or its skeleton until the stats arrive. The dashboard
 * renders it before the data is in, so next/dynamic fetches this chunk
 * alongside the API calls instead of after them.
 */
export function StatusChartPanel({ stats }: { stats?: JobStats }) {
  return stats ? <StatusChart stats={stats} /> : <ChartSkeleton />;
}

/** The funnel chart, or its skeleton until the funnel stats arrive. */
export function FunnelChartPanel({ data }: { data?: FunnelStats }) {
  return data ? (
    <FunnelChart data={data} />
  ) : (
    <ChartSkeleton className={FUNNEL_SKELETON_CLASS} />
  );
}

/** The trend chart, or its skeleton until the trend stats arrive. */
export function TrendChartPanel({ data }: { data?: TrendStats }) {
  return data ? <TrendChart data={data} /> : <ChartSkeleton />;
}
