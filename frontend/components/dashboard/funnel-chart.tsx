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

function MiniBarChart({
  data,
  valueFormatter = (v: number) => `${v}`,
  valueLabel = 'Value',
}: {
  data: { name: string; value: number; color: string }[];
  valueFormatter?: (v: number) => string;
  valueLabel?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(60, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 28 }}>
        <XAxis type="number" allowDecimals={false} hide />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tick={{ fontSize: 12 }}
        />
        <Tooltip
          formatter={(v) => [valueFormatter(Number(v)), valueLabel]}
        />
        <Bar dataKey="value" radius={4}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: React.ReactNode) => valueFormatter(Number(v))}
            style={{ fontSize: 12, fill: 'currentColor' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
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
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 8 }}>
          <XAxis type="number" allowDecimals={false} hide />
          <YAxis
            type="category"
            dataKey="name"
            width={90}
            tick={{ fontSize: 12 }}
          />
          <Tooltip formatter={(v) => [v, 'Reached']} />
          <Bar dataKey="value" radius={4}>
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

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
