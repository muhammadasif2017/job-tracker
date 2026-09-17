'use client';

import { History } from 'lucide-react';
import { Button } from '../ui/button';
import { StatusBadge } from '../ui/badge';
import { formatCivilDate } from '../../lib/utils';
import type { CompanyApplicationHistory } from '../../types';

/** Formats a count with the singular or plural noun. */
const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Props for `CompanyHistoryConfirm`. */
interface CompanyHistoryConfirmProps {
  history: CompanyApplicationHistory;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

/**
 * "You applied here before" prompt showing the company's past jobs and stats.
 *
 * Shown in place of the job form's buttons when the company already has jobs
 * (docs/specs/company-reply-history.md). Advisory: "Add anyway" always saves.
 */
export function CompanyHistoryConfirm({
  history,
  onConfirm,
  onCancel,
  loading,
}: CompanyHistoryConfirmProps) {
  const { company, stats, recentJobs } = history;
  const applied = stats?.applied ?? 0;
  const name = company?.name ?? 'this company';

  return (
    <div
      role="alertdialog"
      aria-labelledby="company-history-title"
      className="space-y-3 rounded-md border border-line bg-paper-raised p-3"
    >
      <div className="flex items-start gap-2">
        <History className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <div className="text-sm">
          <p id="company-history-title" className="font-medium text-ink">
            {applied > 0 && stats?.lastAppliedAt
              ? `You applied to ${name} ${plural(applied, 'time', 'times')}, last on ${formatCivilDate(stats.lastAppliedAt)}.`
              : `You already have jobs saved at ${name}.`}
          </p>
          {applied > 0 && stats && (
            <p className="text-muted">
              {stats.replied} replied, {stats.ghosted} ghosted.
            </p>
          )}
        </div>
      </div>

      <ul className="divide-y divide-line">
        {recentJobs.map((job) => (
          <li
            key={job.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
          >
            <span className="min-w-0 flex-1 break-words text-ink">
              {job.position}
            </span>
            <div className="flex items-center gap-2">
              <StatusBadge status={job.status} />
              <span className="text-xs text-muted-2">
                {formatCivilDate(job.appliedAt)}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" onClick={onConfirm} loading={loading}>
          Add anyway
        </Button>
      </div>
    </div>
  );
}
