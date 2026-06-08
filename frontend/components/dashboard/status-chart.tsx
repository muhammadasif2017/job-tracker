'use client';

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { type JobStats, STATUS_LABELS, STATUS_DOT_COLORS, JOB_STATUSES } from '../../types';

export function StatusChart({ stats }: { stats: JobStats }) {
  const data = JOB_STATUSES.map((s) => ({
    name: STATUS_LABELS[s],
    value: stats.byStatus[s],
    color: STATUS_DOT_COLORS[s],
  })).filter((d) => d.value > 0);

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center text-sm text-slate-400">
        No data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={3} dataKey="value">
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(v) => [v, 'Applications']} />
        <Legend iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}
