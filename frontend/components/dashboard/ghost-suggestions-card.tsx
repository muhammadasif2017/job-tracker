'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Ghost } from 'lucide-react';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';
import { Skeleton, LoadingStatus } from '../ui/skeleton';
import { formatRelative } from '../../lib/utils';
import {
  useGhostSuggestionsQuery,
  useMarkJobGhostedMutation,
  useDismissGhostSuggestionMutation,
  useMarkAllGhostedMutation,
} from '../../features/dashboard/hooks';

// "Looks ghosted": applications with no activity for 14 days. Suggest-only —
// nothing changes status until the user clicks. See
// docs/specs/response-insights.md.
export function GhostSuggestionsCard() {
  const { data: items, isLoading } = useGhostSuggestionsQuery();
  const markGhosted = useMarkJobGhostedMutation();
  const dismiss = useDismissGhostSuggestionMutation();
  const markAll = useMarkAllGhostedMutation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const count = items?.length ?? 0;

  // Disable only the row being acted on, so the rest stay usable while one
  // request is in flight.
  const isBusy = (id: string) =>
    (markGhosted.isPending && markGhosted.variables === id) ||
    (dismiss.isPending && dismiss.variables === id);

  return (
    <div className="rounded-md border border-line bg-paper p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
            Looks Ghosted
          </h2>
          <p className="mt-1 text-xs text-muted-2">No activity for 14+ days</p>
        </div>
        {count > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setConfirmOpen(true)}
          >
            Mark all ghosted ({count})
          </Button>
        )}
      </div>
      {isLoading ? (
        <LoadingStatus label="Loading" className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </LoadingStatus>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-muted-2">
          Nothing looks ghosted — every application had recent activity.
        </p>
      ) : (
        // Up to 200 rows with a near-zero reply rate — scroll inside the card
        // rather than pushing the charts off the page.
        <ul className="max-h-96 divide-y divide-line overflow-y-auto">
          {items.map(({ since, job }) => (
            <li
              key={job.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
            >
              <Link
                href={`/jobs/${job.id}`}
                className="-mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-0.5 transition-colors hover:bg-paper-raised"
              >
                <Ghost className="h-4 w-4 shrink-0 text-muted-2" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {job.company}{' '}
                    <span className="font-normal text-muted">
                      — {job.position}
                    </span>
                  </p>
                  <p className="truncate text-xs text-muted">
                    No activity since {formatRelative(since)}
                  </p>
                </div>
              </Link>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy(job.id)}
                  aria-label={`Mark ${job.company} as ghosted`}
                  onClick={() => markGhosted.mutate(job.id)}
                >
                  Mark ghosted
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isBusy(job.id)}
                  aria-label={`Dismiss suggestion for ${job.company}`}
                  onClick={() => dismiss.mutate(job.id)}
                >
                  Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Mark ${count} ${count === 1 ? 'job' : 'jobs'} as ghosted?`}
        description="Each listed application moves to Ghosted. Any that got activity since this list loaded are skipped."
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button
            loading={markAll.isPending}
            // The list can empty while the dialog is open (e.g. marked from
            // another tab) — an empty id list is a 400, so don't send one.
            disabled={count === 0}
            onClick={() =>
              // The ids on screen at confirm time — the server re-checks each
              // one, so a list that went stale while the dialog was open is safe.
              markAll.mutate(items?.map(({ job }) => job.id) ?? [], {
                onSuccess: () => setConfirmOpen(false),
              })
            }
          >
            Mark {count} ghosted
          </Button>
        </div>
      </Modal>
    </div>
  );
}
