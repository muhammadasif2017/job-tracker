'use client';

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from 'recharts';
import {
  type FunnelStats,
  STATUS_LABELS,
  STATUS_DOT_COLORS,
  SOURCE_LABELS,
} from '../../types';
import { EmptyChartState } from './empty-chart-state';

// Shared by the main funnel bar and the dropoff/avg-time/response-rate
// mini-charts below it — same horizontal-bar layout, differing only in
// height, tooltip label, and whether bars carry an inline value label.
function RangeBarChart({
  data,
  height,
  valueFormatter = (v: number) => `${v}`,
  valueLabel = 'Value',
  showValueLabels = false,
}: {
  data: { name: string; value: number; color: string }[];
  height: number;
  valueFormatter?: (v: number) => string;
  valueLabel?: string;
  showValueLabels?: boolean;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart
        data={data}
        layout="vertical"
        margin={showValueLabels ? { left: 8, right: 28 } : { left: 8 }}
      >
        <XAxis type="number" allowDecimals={false} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tick={{ fontSize: 12 }}
        />
        <Tooltip formatter={(v) => [valueFormatter(Number(v)), valueLabel]} />
        <Bar dataKey="value" radius={4}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
          {showValueLabels && (
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: React.ReactNode) => valueFormatter(Number(v))}
              style={{ fontSize: 12, fill: 'currentColor' }}
            />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function MiniBarChart({
  data,
  valueFormatter,
  valueLabel,
}: {
  data: { name: string; value: number; color: string }[];
  valueFormatter?: (v: number) => string;
  valueLabel?: string;
}) {
  return (
    <RangeBarChart
      data={data}
      height={Math.max(60, data.length * 32)}
      valueFormatter={valueFormatter}
      valueLabel={valueLabel}
      showValueLabels
    />
  );
}

export function FunnelChart({ data }: { data: FunnelStats }) {
  const hasData = data.funnel.some((f) => f.reached > 0);

  const chartData = useMemo(
    () =>
      data.funnel.map((f) => ({
        name: STATUS_LABELS[f.status],
        value: f.reached,
        color: STATUS_DOT_COLORS[f.status],
      })),
    [data.funnel],
  );

  const dropoffData = useMemo(
    () =>
      data.dropoff.map((d) => ({
        name: STATUS_LABELS[d.status],
        value: d.count,
        color: STATUS_DOT_COLORS[d.status],
      })),
    [data.dropoff],
  );

  const avgTimeData = useMemo(
    () =>
      Object.entries(data.avgTimeInStageDays).map(([status, days]) => ({
        name: STATUS_LABELS[status as keyof typeof STATUS_LABELS],
        value: days as number,
        color: STATUS_DOT_COLORS[status as keyof typeof STATUS_DOT_COLORS],
      })),
    [data.avgTimeInStageDays],
  );

  const responseRateData = useMemo(
    () =>
      data.responseRateBySource.map((s) => ({
        name:
          s.source === 'UNSPECIFIED' ? 'Unspecified' : SOURCE_LABELS[s.source],
        value: s.responseRate,
        color: '#6366f1',
      })),
    [data.responseRateBySource],
  );

  if (!hasData) {
    return <EmptyChartState />;
  }

  return (
    <div className="space-y-5">
      <RangeBarChart data={chartData} height={180} valueLabel="Reached" />

      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="mb-1 font-medium text-slate-500">Dropoff</p>
          <MiniBarChart data={dropoffData} valueLabel="Count" />
        </div>

        <div>
          <p className="mb-1 font-medium text-slate-500">
            Avg. time in stage
          </p>
          {avgTimeData.length === 0 ? (
            <p className="text-slate-400">—</p>
          ) : (
            <MiniBarChart
              data={avgTimeData}
              valueFormatter={(v) => `${v}d`}
              valueLabel="Avg days"
            />
          )}
        </div>

        <div>
          <p className="mb-1 font-medium text-slate-500">
            Response rate by source
          </p>
          {responseRateData.length === 0 ? (
            <p className="text-slate-400">—</p>
          ) : (
            <MiniBarChart
              data={responseRateData}
              valueFormatter={(v) => `${v}%`}
              valueLabel="Response rate"
            />
          )}
        </div>
      </div>
    </div>
  );
}
