'use client';

import Link from 'next/link';
import { StatusBadge, PriorityBadge } from '../ui/badge';
import { formatCivilDate } from '../../lib/utils';
import type { CompanyJobSummary } from '../../types';

interface CompanyJobsProps {
  jobs: CompanyJobSummary[];
}

// Phase 6 (docs/specs/company-fk-phase6.md) — read-only list, links to each
// job's existing detail page rather than duplicating job-edit UI here.
export function CompanyJobs({ jobs }: CompanyJobsProps) {
  return (
    <div className="rounded-md border border-line p-3">
      <h3 className="mb-3 font-mono text-[11px] font-medium uppercase tracking-wide text-muted">
        Jobs at this company
      </h3>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-2">
          No jobs linked to this company yet.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {jobs.map((job) => (
            <li key={job.id} className="py-3">
              <Link
                href={`/jobs/${job.id}`}
                className="flex flex-wrap items-center justify-between gap-2 hover:text-accent"
              >
                <span className="min-w-0 flex-1 text-sm font-medium text-ink break-words">
                  {job.position}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={job.status} />
                  <PriorityBadge priority={job.priority} />
                  <span className="text-xs text-muted-2">
                    {formatCivilDate(job.appliedAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
