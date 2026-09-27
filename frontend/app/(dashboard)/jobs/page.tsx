'use client';

import { useState, useCallback } from 'react';
import { useDebounce } from '../../../lib/use-debounce';
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
import Link from 'next/link';
import { Button } from '../../../components/ui/button';
import { Modal } from '../../../components/ui/modal';
import {
  StatusBadge,
  JobTypeBadge,
  SourceBadge,
} from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { JobForm } from '../../../components/jobs/job-form';
import { QuickAdd } from '../../../components/jobs/quick-add';
import { KanbanBoard } from '../../../components/jobs/kanban-board';
import { GhostBadge } from '../../../components/jobs/ghost-badge';
import { cn, formatCivilDate } from '../../../lib/utils';
import {
  JOB_STATUSES,
  STATUS_LABELS,
  type Job,
  type JobStatus,
} from '../../../types';
import {
  useJobsQuery,
  useDeleteJobMutation,
  useExportJobsMutation,
  type JobsFilterValues,
} from '../../../features/jobs/hooks';

/** Hides a jobs-table column below the md breakpoint. */
const MD_ONLY = 'hidden md:table-cell';

/**
 * Jobs-table columns and each one's responsive class. Job type, channel and
 * location drop below md. Below sm each row becomes a card (see `ROW_CARD`)
 * and the rest take a named grid area in it. The header, the skeleton and the
 * data rows all read this, so they cannot drift apart.
 */
const COLUMNS = [
  ['Company', 'max-sm:[grid-area:co] max-sm:text-xs'],
  ['Position', 'max-sm:[grid-area:pos]'],
  ['Status', 'max-sm:[grid-area:st]'],
  ['Job Type', MD_ONLY],
  ['Channel', MD_ONLY],
  ['Applied', 'max-sm:[grid-area:ap] max-sm:self-center max-sm:text-xs'],
  ['Location', MD_ONLY],
  ['', 'max-sm:[grid-area:act]'],
] as const;

/** Header of a jobs-table column. */
type ColumnName = (typeof COLUMNS)[number][0];

/** Base padding plus the column's responsive class for one table cell. */
function cellClass(column: ColumnName, extra?: string) {
  return cn(
    'px-4 py-3 max-sm:p-0',
    COLUMNS.find(([h]) => h === column)![1],
    extra,
  );
}

/**
 * Below sm a row is a card: position and actions on top, company under it,
 * then status and the date. No horizontal scroll to reach the actions.
 */
const ROW_CARD =
  "max-sm:grid max-sm:grid-cols-[auto_1fr_auto] max-sm:gap-x-3 max-sm:gap-y-1 max-sm:px-4 max-sm:py-3 max-sm:[grid-template-areas:'pos_pos_act'_'co_co_act'_'st_ap_ap']";

/**
 * Jobs page (`/jobs`): filtered list or kanban board, with add, Quick Add,
 * edit, delete and CSV export.
 */
export default function JobsPage() {
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');
  // Date-only strings straight from <input type="date">, passed through to
  // the backend's dateFrom/dateTo (which widens dateTo to cover that whole
  // day). '' means "no bound".
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editJob, setEditJob] = useState<Job | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Job | undefined>();

  const debouncedSearch = useDebounce(search);

  // One filter object for the list, the board and the export — they answer
  // the same question and must not drift.
  const filters: JobsFilterValues = {
    search: debouncedSearch,
    status: statusFilter,
    dateFrom,
    dateTo,
  };

  const { data, isLoading, isError, refetch } = useJobsQuery({
    ...filters,
    page,
  });

  const deleteMutation = useDeleteJobMutation(() => setDeleteTarget(undefined));
  const exportMutation = useExportJobsMutation();

  const openEdit = useCallback((job: Job) => {
    setEditJob(job);
    setFormOpen(true);
  }, []);
  const closeForm = useCallback(() => {
    setFormOpen(false);
    setEditJob(undefined);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            Jobs
          </h1>
          <p className="text-sm text-muted">
            {isError && !data
              ? 'Failed to load'
              : `${data?.meta.total ?? 0} ${data?.meta.total === 1 ? 'job' : 'jobs'} tracked`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 whitespace-nowrap">
          <Button
            variant="secondary"
            onClick={() => exportMutation.mutate(filters)}
            // A second click while the first request is in flight downloads
            // the same file twice.
            disabled={exportMutation.isPending}
          >
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
            placeholder="Search company, position, location or notes…"
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
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Applied on or after"
            className="h-9 rounded-md border border-line bg-paper px-3 text-sm text-ink"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
          <span className="text-sm text-muted-2">to</span>
          <input
            type="date"
            aria-label="Applied on or before"
            className="h-9 rounded-md border border-line bg-paper px-3 text-sm text-ink"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                setDateFrom('');
                setDateTo('');
                setPage(1);
              }}
              className="rounded px-2 py-1 font-mono text-xs uppercase tracking-wide text-muted hover:text-accent"
            >
              Clear dates
            </button>
          )}
        </div>
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
        <KanbanBoard onEdit={openEdit} filters={filters} />
      ) : (
        <div className="rounded-md border border-line bg-paper overflow-x-auto">
          {/* Explicit roles: the display:block below sm would otherwise drop the
              table semantics in Chrome and Safari. */}
          <table role="table" className="w-full text-sm max-sm:block">
            <thead
              role="rowgroup"
              className="border-b border-line bg-paper-raised max-sm:hidden"
            >
              <tr role="row">
                {COLUMNS.map(([h, colClass]) => (
                  <th
                    role="columnheader"
                    key={h}
                    className={cn(
                      'px-4 py-3 text-left font-mono text-[11px] font-medium text-muted uppercase tracking-wide',
                      colClass,
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody
              role="rowgroup"
              className="divide-y divide-line max-sm:block"
              aria-busy={isLoading}
            >
              {isLoading ? (
                <>
                  <tr role="row">
                    <td colSpan={8} className="sr-only" role="status">
                      Loading jobs
                    </td>
                  </tr>
                  {[...Array(5)].map((_, i) => (
                    <tr role="row" key={i} className={ROW_CARD}>
                      {COLUMNS.map(([h]) => (
                        <td role="cell" key={h} className={cellClass(h)}>
                          <Skeleton className="h-4 w-full" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </>
              ) : isError && !data ? (
                <tr role="row">
                  <td role="cell" colSpan={8} className="py-16 text-center">
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
                <tr role="row">
                  <td
                    role="cell"
                    colSpan={8}
                    className="py-16 text-center text-muted-2"
                  >
                    <p className="text-base font-medium">No jobs found</p>
                    <p className="mt-1 text-sm">
                      Add your first application to get started.
                    </p>
                  </td>
                </tr>
              ) : (
                data?.data.map((job) => (
                  <tr
                    role="row"
                    key={job.id}
                    className={cn(
                      'transition-colors hover:bg-paper-raised',
                      ROW_CARD,
                    )}
                  >
                    <td
                      role="cell"
                      className={cellClass('Company', 'text-muted')}
                    >
                      {job.company}
                    </td>
                    <td role="cell" className={cellClass('Position')}>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {job.position}
                      </Link>
                    </td>
                    <td role="cell" className={cellClass('Status')}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={job.status} />
                        <GhostBadge jobId={job.id} company={job.company} />
                      </div>
                    </td>
                    <td role="cell" className={cellClass('Job Type')}>
                      <JobTypeBadge jobType={job.jobType} />
                    </td>
                    <td role="cell" className={cellClass('Channel')}>
                      {job.applicationChannel ? (
                        <SourceBadge
                          kind="channel"
                          source={job.applicationChannel}
                        />
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td
                      role="cell"
                      className={cellClass(
                        'Applied',
                        'text-muted whitespace-nowrap',
                      )}
                    >
                      {/* A wishlist job has not been applied to: its date is
                          when it was saved, re-stamped once it leaves WISHLIST. */}
                      {job.status === 'WISHLIST' && 'Saved '}
                      {formatCivilDate(job.appliedAt)}
                    </td>
                    <td
                      role="cell"
                      className={cellClass('Location', 'text-muted')}
                    >
                      {job.location ?? '—'}
                    </td>
                    <td role="cell" className={cellClass('')}>
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
      <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} />

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
