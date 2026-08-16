'use client';

import Link from 'next/link';
import { StatusBadge, PriorityBadge } from '../ui/badge';
import { formatDate } from '../../lib/utils';
import type { CompanyJobSummary } from '../../types';

interface CompanyJobsProps {
  jobs: CompanyJobSummary[];
}

// Phase 6 (docs/specs/company-fk-phase6.md) — read-only list, links to each
// job's existing detail page rather than duplicating job-edit UI here.
export function CompanyJobs({ jobs }: CompanyJobsProps) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h3 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
        Jobs at this company
      </h3>

      {jobs.length === 0 ? (
        <p className="text-sm text-slate-400">
          No jobs linked to this company yet.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {jobs.map((job) => (
            <li key={job.id} className="py-3">
              <Link
                href={`/jobs/${job.id}`}
                className="flex flex-wrap items-center justify-between gap-2 hover:text-indigo-600"
              >
                <span className="min-w-0 flex-1 text-sm font-medium break-words">
                  {job.position}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={job.status} />
                  <PriorityBadge priority={job.priority} />
                  <span className="text-xs text-slate-400">
                    {formatDate(job.appliedAt)}
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
