'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { CircuitStateBadge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { cn } from '../../lib/utils';
import { useAdminQueuesQuery } from '../../features/admin/hooks';
import type { CircuitStatus, QueueSnapshot } from '../../types';

/** Readable names for the BullMQ queues, keyed by queue name. */
const QUEUE_LABELS: Record<string, string> = {
  'company-target-enrichment': 'Company enrichment',
  'job-timeline-summary': 'Timeline summary',
  notifications: 'Notifications',
};

/** The queue states shown on each card, in display order. */
const COUNT_ROWS = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'active', label: 'Active' },
  { key: 'delayed', label: 'Delayed' },
  { key: 'failed', label: 'Failed' },
  { key: 'completed', label: 'Completed' },
] as const;

/** One labelled figure in a `CountGrid`. */
interface Count {
  key: string;
  label: string;
  value: number;
  /** Draw the figure in the danger color. */
  danger?: boolean;
}

/**
 * A row of labelled counts, shared by the queue cards and the database card
 * so the two read alike. Three to a line until the card is 19rem wide, then
 * five: sized on the card, not the viewport, because a queue card is narrow
 * both on a phone and in the three-up desktop grid. Capped at max-w-lg so
 * the full-width database card does not spread five figures edge to edge.
 */
function CountGrid({ counts }: { counts: Count[] }) {
  return (
    <dl className="mt-3 grid max-w-lg grid-cols-3 gap-x-2 gap-y-3 text-center @[19rem]:grid-cols-5">
      {counts.map(({ key, label, value, danger }) => (
        <div key={key}>
          <dt className="text-xs text-muted font-medium">{label}</dt>
          <dd
            className={cn(
              'mt-0.5 text-base font-semibold tabular-nums text-ink',
              danger && 'text-danger',
            )}
          >
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One queue's job counts, or a warning when Redis did not answer. */
function QueueCard({ queue }: { queue: QueueSnapshot }) {
  const counts = queue.counts;
  return (
    <div className="@container rounded-md border border-line bg-paper p-4">
      {/* Wraps rather than squeezing: the mono queue name drops to its own
          line whole instead of breaking at its hyphens. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <h3 className="text-sm font-medium text-ink">
          {QUEUE_LABELS[queue.name] ?? queue.name}
        </h3>
        {/* max-w-full + truncate: a name wider than the card itself (an
            unlabelled future queue) clips instead of spilling past the border. */}
        <span
          title={queue.name}
          className="max-w-full truncate font-mono text-[11px] text-muted-2"
        >
          {queue.name}
        </span>
      </div>
      {counts ? (
        <CountGrid
          counts={COUNT_ROWS.map(({ key, label }) => ({
            key,
            label,
            value: counts[key],
            danger: key === 'failed' && counts[key] > 0,
          }))}
        />
      ) : (
        <p className="mt-3 text-sm text-warning">
          Queue unreachable — Redis is not answering. Database figures below are
          still accurate.
        </p>
      )}
    </div>
  );
}

/** Text color for each breaker state's detail sentence. */
const CIRCUIT_DETAIL_TONE: Record<CircuitStatus['state'], string> = {
  closed: 'text-muted',
  'half-open': 'text-warning',
  open: 'text-danger',
};

/**
 * What a circuit is doing, in words. An open circuit names the clock time of
 * its trial call rather than a countdown: the data may come from a cache
 * entry up to 30s old, and an absolute time stays right regardless.
 */
function circuitDetail(circuit: CircuitStatus): string {
  if (circuit.state === 'closed') return 'Calls pass through.';
  if (circuit.state === 'half-open') return 'One trial call in flight.';
  if (!circuit.retryAfterMs || circuit.retryAt === null) {
    return 'Cool-down over; the next call is the trial.';
  }
  const at = new Date(circuit.retryAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  return `Failing fast; trial call from ${at}.`;
}

/**
 * The admin queues page body: per-queue depth, the circuit breakers in front
 * of upstream services, enrichment status counts from the database, and a
 * warning for companies stranded at PENDING. Refreshes only on demand.
 */
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

            {data.circuits.length > 0 && (
              <div className="rounded-md border border-line bg-paper p-4">
                <h3 className="text-sm font-medium text-ink">
                  Upstream circuit breakers
                </h3>
                <ul className="mt-3 space-y-2">
                  {data.circuits.map((circuit) => (
                    <li
                      key={circuit.name}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                    >
                      <span className="font-medium text-ink">
                        {circuit.name}
                      </span>
                      <CircuitStateBadge state={circuit.state} />
                      {/* The chip's dot alone is too quiet for the one row
                          whose job is to alert: a tripped breaker also
                          colors its sentence. */}
                      <span className={CIRCUIT_DETAIL_TONE[circuit.state]}>
                        {circuitDetail(circuit)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="@container rounded-md border border-line bg-paper p-4">
              <h3 className="text-sm font-medium text-ink">
                Company enrichment status (database)
              </h3>
              <CountGrid
                counts={data.companyStatuses.map((bucket) => ({
                  key: bucket.status ?? 'never-triggered',
                  label: bucket.label,
                  value: bucket.count,
                }))}
              />
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
