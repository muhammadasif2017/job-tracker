'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Plus,
  Sparkles,
  Search,
  ExternalLink,
  Pencil,
  Trash2,
  LayoutGrid,
  List,
  Download,
} from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import {
  StatusBadge,
  PriorityBadge,
  JobTypeBadge,
  SourceBadge,
} from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { JobForm } from '../../../components/jobs/job-form';
import { QuickAdd } from '../../../components/jobs/quick-add';
import { KanbanBoard } from '../../../components/jobs/kanban-board';
import { formatDateOnly } from '../../../lib/utils';
import {
  JOB_STATUSES,
  STATUS_LABELS,
  JOB_PRIORITIES,
  PRIORITY_LABELS,
  type Job,
  type JobStatus,
  type JobPriority,
} from '../../../types';
import api from '../../../lib/api';
import { useJobsQuery, useDeleteJobMutation } from '../../../features/jobs/hooks';

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

// `attachment; filename="jobs-offer.csv"` -> `jobs-offer.csv`. Falls back to
// the caller's default for a missing or unparseable header (e.g. a same-origin
// dev setup where the header isn't exposed).
function filenameFromDisposition(
  header: unknown,
  fallback: string,
): string {
  if (typeof header !== 'string') return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1]?.trim() || fallback;
}

export default function JobsPage() {
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | ''>('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editJob, setEditJob] = useState<Job | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Job | undefined>();

  const debouncedSearch = useDebounce(search);

  const { data, isLoading, isError, refetch } = useJobsQuery({
    page,
    search: debouncedSearch,
    status: statusFilter,
    priority: priorityFilter,
  });

  const deleteMutation = useDeleteJobMutation(() => setDeleteTarget(undefined));

  const openEdit = useCallback((job: Job) => {
    setEditJob(job);
    setFormOpen(true);
  }, []);
  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditJob(undefined);
  }, []);

  const handleExport = async () => {
    try {
      const exportParams = new URLSearchParams();
      if (debouncedSearch) exportParams.set('search', debouncedSearch);
      if (statusFilter) exportParams.set('status', statusFilter);
      if (priorityFilter) exportParams.set('priority', priorityFilter);
      const res = await api.get(`/jobs/export?${exportParams}`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      // Prefer the server's filename — it carries the status suffix for a
      // filtered export (jobs-offer.csv). Both this and X-Export-Truncated
      // are only readable because main.ts lists them in the CORS
      // `exposedHeaders`.
      // `res.headers` is always present from a real axios response; the
      // fallback keeps this from throwing on a hand-rolled response object.
      const headers = (res.headers ?? {}) as Record<string, unknown>;
      a.download = filenameFromDisposition(
        headers['content-disposition'],
        'jobs.csv',
      );
      a.click();
      URL.revokeObjectURL(url);
      // The export is capped server-side. Without this the user just gets a
      // short file and no reason to doubt it.
      if (headers['x-export-truncated'] === 'true') {
        toast.warning(
          'Export was truncated at 1000 rows — narrow the filters to export the rest.',
        );
      }
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Jobs</h1>
          <p className="text-sm text-muted">
            {isError && !data
              ? 'Failed to load'
              : `${data?.meta.total ?? 0} applications tracked`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button variant="secondary" onClick={() => setQuickAddOpen(true)}>
            <Sparkles className="h-4 w-4" /> Quick Add
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add Job
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-2" />
          <input
            aria-label="Search jobs"
            className="h-9 w-full rounded-md border border-line bg-paper pl-9 pr-3 text-sm text-ink placeholder:text-muted-2 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            placeholder="Search company or position…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          aria-label="Filter by status"
          className="h-9 rounded-md border border-line bg-paper px-3 text-sm text-ink"
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as JobStatus | '');
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {JOB_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by priority"
          className="h-9 rounded-md border border-line bg-paper px-3 text-sm text-ink"
          value={priorityFilter}
          onChange={(e) => {
            setPriorityFilter(e.target.value as JobPriority | '');
            setPage(1);
          }}
        >
          <option value="">All priorities</option>
          {JOB_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <div className="flex rounded-md border border-line">
          <button
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={`flex items-center gap-1.5 rounded-l-[5px] px-3 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${view === 'list' ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-paper-raised'}`}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            onClick={() => setView('kanban')}
            aria-pressed={view === 'kanban'}
            className={`flex items-center gap-1.5 rounded-r-[5px] px-3 py-1.5 font-mono text-xs uppercase tracking-wide transition-colors ${view === 'kanban' ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-paper-raised'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Board
          </button>
        </div>
      </div>

      {view === 'kanban' ? (
        <KanbanBoard onEdit={openEdit} />
      ) : (
        <div className="rounded-md border border-line bg-paper overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-paper-raised">
              <tr>
                {[
                  'Company',
                  'Position',
                  'Status',
                  'Priority',
                  'Job Type',
                  'Channel',
                  'Applied',
                  'Location',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-mono text-[11px] font-medium text-muted uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              className="divide-y divide-line"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <tr>
                    <td colSpan={9} className="sr-only" role="status">
                      Loading jobs
                    </td>
                  </tr>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(9)].map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : isError && !data ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center">
                    <p className="text-base font-medium text-danger">
                      Failed to load jobs
                    </p>
                    <p className="mt-1 text-sm text-muted-2">
                      Check your connection and try again.
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-3"
                      onClick={() => refetch()}
                    >
                      Retry
                    </Button>
                  </td>
                </tr>
              ) : data?.data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-16 text-center text-muted-2">
                    <p className="text-base font-medium">No jobs found</p>
                    <p className="mt-1 text-sm">
                      Add your first application to get started.
                    </p>
                  </td>
                </tr>
              ) : (
                data?.data.map((job) => (
                  <tr
                    key={job.id}
                    className="transition-colors hover:bg-paper-raised"
                  >
                    <td className="px-4 py-3 text-muted">
                      {job.company}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {job.position}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3">
                      <PriorityBadge priority={job.priority} />
                    </td>
                    <td className="px-4 py-3">
                      <JobTypeBadge jobType={job.jobType} />
                    </td>
                    <td className="px-4 py-3">
                      {job.applicationChannel ? (
                        <SourceBadge
                          kind="channel"
                          source={job.applicationChannel}
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted whitespace-nowrap">
                      {formatDateOnly(job.appliedAt)}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {job.location ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {job.url && (
                          <a
                            href={job.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`View job posting for ${job.company}`}
                            className="rounded p-1.5 text-muted-2 hover:text-accent"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => openEdit(job)}
                          aria-label={`Edit ${job.company}`}
                          className="rounded p-1.5 text-muted-2 hover:text-accent"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(job)}
                          aria-label={`Delete ${job.company}`}
                          className="rounded p-1.5 text-muted-2 hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {data && data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm text-muted">
              <span>
                Page {page} of {data.meta.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page === data.meta.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <JobForm open={formOpen} onClose={closeForm} job={editJob} />
      <QuickAdd
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(undefined)}
        title="Delete job?"
        description={
          deleteTarget
            ? `Remove ${deleteTarget.company} — ${deleteTarget.position}? This cannot be undone.`
            : undefined
        }
      >
        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={() => setDeleteTarget(undefined)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() =>
              deleteTarget && deleteMutation.mutate(deleteTarget.id)
            }
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
