'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  type FunnelStats,
  STATUS_LABELS,
  STATUS_DOT_COLORS,
  SOURCE_LABELS,
} from '../../types';

export function FunnelChart({ data }: { data: FunnelStats }) {
  const hasData = data.funnel.some((f) => f.reached > 0);

  if (!hasData) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        No data yet
      </div>
    );
  }

  const chartData = data.funnel.map((f) => ({
    name: STATUS_LABELS[f.status],
    value: f.reached,
    color: STATUS_DOT_COLORS[f.status],
  }));

  const avgTimeEntries = Object.entries(data.avgTimeInStageDays);

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
          <Tooltip formatter={(v: number) => [v, 'Reached']} />
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
          {data.dropoff.map((d) => (
            <p key={d.status}>
              {STATUS_LABELS[d.status]}: {d.count}
            </p>
          ))}
        </div>

        <div>
          <p className="mb-1 font-medium text-slate-500">
            Avg. time in stage
          </p>
          {avgTimeEntries.length === 0 ? (
            <p className="text-slate-400">—</p>
          ) : (
            avgTimeEntries.map(([status, days]) => (
              <p key={status}>
                {STATUS_LABELS[status as keyof typeof STATUS_LABELS]}: {days}d
              </p>
            ))
          )}
        </div>

        <div>
          <p className="mb-1 font-medium text-slate-500">
            Response rate by source
          </p>
          {data.responseRateBySource.length === 0 ? (
            <p className="text-slate-400">—</p>
          ) : (
            data.responseRateBySource.map((s) => (
              <p key={s.source}>
                {s.source === 'UNSPECIFIED' ? 'Unspecified' : SOURCE_LABELS[s.source]}
                : {s.responseRate}%
              </p>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
