'use client';

import { formatCivilDate } from '../../lib/utils';
import type { CompanyApplicationStats } from '../../types';

/**
 * A company's applied, replied and ghosted counts with its reply rate.
 *
 * docs/specs/company-reply-history.md — how applying to this company has gone.
 * Replied and Ghosted are separate figures, not parts of one total: a job that
 * got an interview and then went silent counts in both.
 */
export function CompanyApplicationStatsStrip({
  stats,
}: {
  stats: CompanyApplicationStats;
}) {
  return (
    <div className="rounded-md border border-line p-3">
      <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-muted">
        Application history
      </h3>

      {stats.applied === 0 ? (
        <p className="text-sm text-muted-2">No applications yet.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
          <Stat label="Applied" value={stats.applied} />
          <Stat label="Replied" value={stats.replied} />
          <Stat label="Ghosted" value={stats.ghosted} />
          <Stat label="Reply rate" value={`${stats.replyRate}%`} />
          <Stat
            label="Last applied"
            value={
              stats.lastAppliedAt ? formatCivilDate(stats.lastAppliedAt) : '—'
            }
          />
        </dl>
      )}
    </div>
  );
}

/** One labelled figure in the stats strip. */
function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-display text-lg font-semibold tracking-tight text-ink">
        {value}
      </dd>
    </div>
  );
}
