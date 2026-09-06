'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import {
  type JobStats,
  STATUS_LABELS,
  STATUS_FILL_CLASSES,
  STATUS_DOT_VARS,
  JOB_STATUSES,
} from '../../types';
import { EmptyChartState } from './empty-chart-state';
import { ChartLegend } from './chart-legend';

export function StatusChart({ stats }: { stats: JobStats }) {
  const data = JOB_STATUSES.map((s) => ({
    name: STATUS_LABELS[s],
    value: stats.byStatus[s],
    className: STATUS_FILL_CLASSES[s],
    color: STATUS_DOT_VARS[s],
  })).filter((d) => d.value > 0);

  if (data.length === 0) {
    return <EmptyChartState />;
  }

  return (
    <>
      <ResponsiveContainer width="100%" height={220}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={3}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell key={entry.name} className={entry.className} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => [v, 'Applications']} />
        </PieChart>
      </ResponsiveContainer>
      <ChartLegend
        items={data.map((d) => ({ label: d.name, color: d.color }))}
      />
    </>
  );
}
