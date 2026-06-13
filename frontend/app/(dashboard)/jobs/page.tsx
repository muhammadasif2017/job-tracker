'use client';

import { useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus,
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
import { Input } from '../../../components/ui/input';
import { Modal } from '../../../components/ui/modal';
import { StatusBadge, PriorityBadge } from '../../../components/ui/badge';
import { Skeleton } from '../../../components/ui/skeleton';
import { JobForm } from '../../../components/jobs/job-form';
import { KanbanBoard } from '../../../components/jobs/kanban-board';
import { formatDate } from '../../../lib/utils';
import {
  JOB_STATUSES,
  STATUS_LABELS,
  JOB_PRIORITIES,
  PRIORITY_LABELS,
  type Job,
  type PaginatedJobs,
  type JobStatus,
  type JobPriority,
} from '../../../types';
import api from '../../../lib/api';

function useDebounce<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function JobsPage() {
  const qc = useQueryClient();
  const [view, setView] = useState<'list' | 'kanban'>('list');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<JobStatus | ''>('');
  const [priorityFilter, setPriorityFilter] = useState<JobPriority | ''>('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editJob, setEditJob] = useState<Job | undefined>();
  const [deleteTarget, setDeleteTarget] = useState<Job | undefined>();

  const debouncedSearch = useDebounce(search);

  const params = new URLSearchParams({
    page: String(page),
    limit: '10',
    sortBy: 'appliedAt',
    sortOrder: 'desc',
    ...(debouncedSearch && { search: debouncedSearch }),
    ...(statusFilter && { status: statusFilter }),
    ...(priorityFilter && { priority: priorityFilter }),
  });

  const { data, isLoading } = useQuery<PaginatedJobs>({
    queryKey: [
      'jobs',
      {
        page,
        search: debouncedSearch,
        status: statusFilter,
        priority: priorityFilter,
      },
    ],
    queryFn: () => api.get(`/jobs?${params}`).then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/jobs/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
      setDeleteTarget(undefined);
      toast.success('Job deleted');
    },
  });

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
      a.download = 'jobs.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Jobs</h1>
          <p className="text-sm text-slate-500">
            {data?.meta.total ?? 0} applications tracked
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          <Button onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add Job
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            aria-label="Search jobs"
            className="h-9 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-900"
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
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
          className="h-9 rounded-lg border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
        <div className="flex rounded-lg border border-slate-300 dark:border-slate-700">
          <button
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-l-lg transition-colors ${view === 'list' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            onClick={() => setView('kanban')}
            aria-pressed={view === 'kanban'}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-r-lg transition-colors ${view === 'kanban' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-slate-800'}`}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Board
          </button>
        </div>
      </div>

      {view === 'kanban' ? (
        <KanbanBoard onEdit={openEdit} />
      ) : (
        <div className="rounded-xl border bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 dark:bg-slate-800/50">
              <tr>
                {[
                  'Company',
                  'Position',
                  'Status',
                  'Priority',
                  'Applied',
                  'Location',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : data?.data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center text-slate-400">
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
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {job.company}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100"
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
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {formatDate(job.appliedAt)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
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
                            className="rounded p-1.5 text-slate-400 hover:text-indigo-600"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <button
                          onClick={() => openEdit(job)}
                          aria-label={`Edit ${job.company}`}
                          className="rounded p-1.5 text-slate-400 hover:text-indigo-600"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(job)}
                          aria-label={`Delete ${job.company}`}
                          className="rounded p-1.5 text-slate-400 hover:text-red-600"
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
            <div className="flex items-center justify-between border-t px-4 py-3 text-sm text-slate-500">
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
