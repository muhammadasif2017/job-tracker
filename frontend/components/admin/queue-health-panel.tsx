'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';
import { useAdminQueuesQuery } from '../../features/admin/hooks';
import type { QueueSnapshot } from '../../types';

const QUEUE_LABELS: Record<string, string> = {
  'company-target-enrichment': 'Company enrichment',
  'job-timeline-summary': 'Timeline summary',
  notifications: 'Notifications',
};

const COUNT_ROWS = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'active', label: 'Active' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'failed', label: 'Failed' },
  { key: 'completed', label: 'Completed' },
] as const;

function QueueCard({ queue }: { queue: QueueSnapshot }) {
  const counts = queue.counts;
  return (
    <div className="rounded-md border border-line bg-paper p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">
          {QUEUE_LABELS[queue.name] ?? queue.name}
        </h3>
        <span className="font-mono text-[11px] text-muted-2">{queue.name}</span>
      </div>
      {counts ? (
        <dl className="mt-3 grid grid-cols-5 gap-2 text-center">
          {COUNT_ROWS.map(({ key, label }) => (
            <div key={key}>
              <dt className="font-mono text-[11px] uppercase tracking-wide text-muted-2">
                {label}
              </dt>
              <dd
                className={cn(
                  'mt-0.5 text-base font-semibold tabular-nums text-ink',
                  key === 'failed' && counts[key] > 0 && 'text-danger',
                )}
              >
                {counts[key]}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-sm text-warning">
          Queue unreachable — Redis is not answering. Database figures below are
          still accurate.
        </p>
      )}
    </div>
  );
}

export function QueueHealthPanel() {
  const { data, isLoading, isError, refetch, isFetching } =
    useAdminQueuesQuery();

  return (
    <section aria-labelledby="queue-health-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2
            id="queue-health-heading"
            className="font-display text-lg font-semibold tracking-tight text-ink"
          >
            Queue health
          </h2>
          <p className="text-sm text-muted">
            BullMQ depth alongside the enrichment status stored in Postgres — a
            row stranded in one is invisible in the other.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          loading={isFetching}
          onClick={() => refetch()}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="status">
          <span className="sr-only">Loading queue health</span>
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : isError && !data ? (
        <div className="rounded-md border border-line bg-paper px-4 py-6 text-center">
          <p className="text-base font-medium text-danger">
            Failed to load queue health
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => refetch()}
          >
            Retry
          </Button>
        </div>
      ) : (
        data && (
          <>
            {data.strandedPending !== null && data.strandedPending > 0 && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-md border border-danger/40 bg-danger-soft px-4 py-3"
              >
                <AlertTriangle
                  className="mt-0.5 h-4 w-4 shrink-0 text-danger"
                  aria-hidden="true"
                />
                <div className="text-sm">
                  <p className="font-medium text-danger">
                    <span className="tabular-nums">{data.strandedPending}</span>{' '}
                    stranded{' '}
                    {data.strandedPending === 1 ? 'company' : 'companies'} — at
                    PENDING with no enrichment job queued.
                  </p>
                  <p className="mt-1 text-muted">
                    These show “Queued…” forever, and a retry is rejected with
                    409 because the status is already PENDING. They need
                    clearing in the database.
                  </p>
                </div>
              </div>
            )}

            {data.strandedPending === null && (
              <p className="text-sm text-warning">
                Stranded-company detection is unavailable while the enrichment
                queue is unreachable.
              </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.queues.map((q) => (
                <QueueCard key={q.name} queue={q} />
              ))}
            </div>

            <div className="rounded-md border border-line bg-paper p-4">
              <h3 className="text-sm font-medium text-ink">
                Company enrichment status (database)
              </h3>
              <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-3">
                {data.companyStatuses.map((bucket) => (
                  <div key={bucket.status ?? 'never-triggered'}>
                    <dt className="font-mono text-[11px] uppercase tracking-wide text-muted-2">
                      {bucket.label}
                    </dt>
                    <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
                      {bucket.count}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-2">
                “Never triggered” is the resting state for imported companies —
                the CSV importer does not enqueue enrichment. It is not an
                error.
              </p>
            </div>
          </>
        )
      )}
    </section>
  );
}
