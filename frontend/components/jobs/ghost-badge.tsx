'use client';

import { Ghost, X } from 'lucide-react';
import {
  useGhostSuggestedIds,
  useMarkJobGhostedMutation,
  useDismissGhostSuggestionMutation,
} from '../../features/dashboard/hooks';

/** Props for `GhostBadge`. */
interface GhostBadgeProps {
  jobId: string;
  company: string;
}

/**
 * "No reply 14d+" marker for the jobs list and kanban cards, with the same two
 * actions as the dashboard's Looks Ghosted card. Reads the shared
 * ['ghost-suggestions'] query, so every badge on the page costs one request,
 * and renders nothing for a job that isn't a suggestion.
 */
export function GhostBadge({ jobId, company }: GhostBadgeProps) {
  const { data: suggestedIds } = useGhostSuggestedIds();
  const markGhosted = useMarkJobGhostedMutation();
  const dismiss = useDismissGhostSuggestionMutation();

  if (!suggestedIds?.has(jobId)) return null;
  const busy = markGhosted.isPending || dismiss.isPending;

  return (
    <span className="inline-flex items-center gap-0.5 rounded-sm border border-line bg-paper-raised py-0.5 pl-1.5 pr-0.5 font-mono text-[11px] text-muted whitespace-nowrap">
      No reply 14d+
      <button
        type="button"
        disabled={busy}
        onClick={() => markGhosted.mutate(jobId)}
        aria-label={`Mark ${company} as ghosted`}
        title="Mark ghosted"
        className="ml-0.5 rounded p-0.5 text-muted-2 hover:text-ink disabled:opacity-50"
      >
        <Ghost className="h-3 w-3" />
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => dismiss.mutate(jobId)}
        aria-label={`Dismiss suggestion for ${company}`}
        title="Dismiss"
        className="rounded p-0.5 text-muted-2 hover:text-ink disabled:opacity-50"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
