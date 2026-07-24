'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { TrendStats } from '../../types';
import { EmptyChartState } from './empty-chart-state';

export function TrendChart({ data }: { data: TrendStats }) {
  const chartData = useMemo(
    () =>
      data.buckets.map((b) => ({
        label: b.label,
        count: b.count,
        cumulative: b.cumulative,
      })),
    [data.buckets],
  );

  if (data.buckets.length === 0) {
    return <EmptyChartState />;
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ left: -16 }}>
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis yAxisId="count" allowDecimals={false} tick={{ fontSize: 12 }} />
        <YAxis
          yAxisId="cumulative"
          orientation="right"
          allowDecimals={false}
          tick={{ fontSize: 12 }}
        />
        <Tooltip />
        <Legend />
        <Bar
          yAxisId="count"
          dataKey="count"
          name="New applications"
          fill="#3b82f6"
          radius={4}
        />
        <Line
          yAxisId="cumulative"
          type="monotone"
          dataKey="cumulative"
          name="Cumulative total"
          stroke="#10b981"
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
