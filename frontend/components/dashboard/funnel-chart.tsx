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
  STATUS_FILL_CLASSES,
  APPLICATION_CHANNEL_LABELS,
  DISCOVERY_SOURCE_LABELS,
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
  data: { name: string; value: number; className: string }[];
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
        margin={showValueLabels ? { left: 8, right: 48 } : { left: 8 }}
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
            <Cell key={entry.name} className={entry.className} />
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
  data: { name: string; value: number; className: string }[];
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

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function ReplyTiming({ timing }: { timing: FunnelStats['replyTiming'] }) {
  if (timing.medianDays === null) {
    return <p className="text-muted-2">No replies yet</p>;
  }
  return (
    <div>
      <p className="font-display text-2xl font-semibold tracking-tight text-ink">
        {plural(timing.medianDays, 'day', 'days')}
      </p>
      <p className="text-xs text-muted">
        median across {plural(timing.repliedCount, 'reply', 'replies')}
      </p>
      {/* Measured against the 14-day "looks ghosted" cutoff — how often a
          real reply came after a job would already have been flagged. */}
      <p className="mt-1 text-xs text-muted">
        {timing.repliedAfter14DaysPercent}% arrived after 14 days
      </p>
    </div>
  );
}

export function FunnelChart({ data }: { data: FunnelStats }) {
  const hasData = data.funnel.some((f) => f.reached > 0);

  const chartData = useMemo(
    () =>
      data.funnel.map((f) => ({
        name: STATUS_LABELS[f.status],
        value: f.reached,
        className: STATUS_FILL_CLASSES[f.status],
      })),
    [data.funnel],
  );

  const dropoffData = useMemo(
    () =>
      data.dropoff.map((d) => ({
        name: STATUS_LABELS[d.status],
        value: d.count,
        className: STATUS_FILL_CLASSES[d.status],
      })),
    [data.dropoff],
  );

  const avgTimeData = useMemo(
    () =>
      Object.entries(data.avgTimeInStageDays).map(([status, days]) => ({
        name: STATUS_LABELS[status as keyof typeof STATUS_LABELS],
        value: days as number,
        className:
          STATUS_FILL_CLASSES[status as keyof typeof STATUS_FILL_CLASSES],
      })),
    [data.avgTimeInStageDays],
  );

  const responseRateData = useMemo(
    () =>
      data.responseRateBySource.map((s) => ({
        name:
          s.source === 'UNSPECIFIED'
            ? 'Unspecified'
            : APPLICATION_CHANNEL_LABELS[s.source],
        value: s.responseRate,
        className: 'fill-accent',
      })),
    [data.responseRateBySource],
  );

  const discoveryRateData = useMemo(
    () =>
      data.responseRateByDiscoverySource.map((s) => ({
        name:
          s.source === 'UNSPECIFIED'
            ? 'Unspecified'
            : DISCOVERY_SOURCE_LABELS[s.source],
        value: s.responseRate,
        className: 'fill-accent',
      })),
    [data.responseRateByDiscoverySource],
  );

  if (!hasData) {
    return <EmptyChartState />;
  }

  return (
    <div className="space-y-5">
      <RangeBarChart data={chartData} height={180} valueLabel="Reached" />

      <div className="grid gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted">
            Dropoff
          </p>
          <MiniBarChart data={dropoffData} valueLabel="Count" />
        </div>

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted">
            Avg. time in stage
          </p>
          {avgTimeData.length === 0 ? (
            <p className="text-muted-2">—</p>
          ) : (
            <MiniBarChart
              data={avgTimeData}
              valueFormatter={(v) => `${v}d`}
              valueLabel="Avg days"
            />
          )}
        </div>

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted">
            Time to reply
          </p>
          <ReplyTiming timing={data.replyTiming} />
        </div>
      </div>

      {/* Side by side so the two answers to "what gets replies" compare at a
          glance: how you applied vs. where you found the job. */}
      <div className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted">
            Response rate by application channel
          </p>
          {responseRateData.length === 0 ? (
            <p className="text-muted-2">—</p>
          ) : (
            <MiniBarChart
              data={responseRateData}
              valueFormatter={(v) => `${v}%`}
              valueLabel="Response rate"
            />
          )}
        </div>

        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-wide text-muted">
            Response rate by discovery source
          </p>
          {discoveryRateData.length === 0 ? (
            <p className="text-muted-2">—</p>
          ) : (
            <MiniBarChart
              data={discoveryRateData}
              valueFormatter={(v) => `${v}%`}
              valueLabel="Response rate"
            />
          )}
        </div>
      </div>
    </div>
  );
}
