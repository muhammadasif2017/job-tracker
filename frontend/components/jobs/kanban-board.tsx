'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import { Pencil, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { StatusBadge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { formatDate } from '../../lib/utils';
import { JOB_STATUSES, STATUS_LABELS, STATUS_DOT_COLORS, type Job, type JobStatus, type PaginatedJobs } from '../../types';
import api from '../../lib/api';

const KANBAN_COLS: JobStatus[] = ['WISHLIST', 'APPLIED', 'INTERVIEWING', 'OFFER'];

interface KanbanBoardProps {
  onEdit: (job: Job) => void;
}

export function KanbanBoard({ onEdit }: KanbanBoardProps) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<PaginatedJobs>({
    queryKey: ['jobs', { limit: 100 }],
    queryFn: () => api.get('/jobs?limit=100').then((r) => r.data),
  });

  const patchStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JobStatus }) =>
      api.patch(`/jobs/${id}`, { status }).then((r) => r.data),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: ['jobs'] });
      const prev = qc.getQueryData<PaginatedJobs>(['jobs', { limit: 100 }]);
      qc.setQueryData<PaginatedJobs>(['jobs', { limit: 100 }], (old) =>
        old ? { ...old, data: old.data.map((j) => (j.id === id ? { ...j, status } : j)) } : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['jobs', { limit: 100 }], ctx.prev);
      toast.error('Failed to update status');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as JobStatus;
    const jobId = result.draggableId;
    const job = data?.data.find((j) => j.id === jobId);
    if (job && job.status !== newStatus) {
      patchStatus.mutate({ id: jobId, status: newStatus });
    }
  };

  if (isLoading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-4">
        {KANBAN_COLS.map((col) => (
          <div key={col} className="w-64 shrink-0 space-y-3">
            <Skeleton className="h-6 w-32" />
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ))}
      </div>
    );
  }

  const jobsByStatus = KANBAN_COLS.reduce(
    (acc, s) => ({ ...acc, [s]: data?.data.filter((j) => j.status === s) ?? [] }),
    {} as Record<JobStatus, Job[]>,
  );

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {KANBAN_COLS.map((col) => (
          <div key={col} className="w-64 shrink-0">
            <div className="mb-3 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: STATUS_DOT_COLORS[col] }} />
              <span className="text-sm font-medium">{STATUS_LABELS[col]}</span>
              <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                {jobsByStatus[col].length}
              </span>
            </div>
            <Droppable droppableId={col}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-20 space-y-2 rounded-xl p-2 transition-colors ${snapshot.isDraggingOver ? 'bg-indigo-50 dark:bg-indigo-950/30' : 'bg-slate-100/50 dark:bg-slate-800/30'}`}
                >
                  {jobsByStatus[col].map((job, idx) => (
                    <Draggable key={job.id} draggableId={job.id} index={idx}>
                      {(drag, snap) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          {...drag.dragHandleProps}
                          className={`rounded-lg border bg-white p-3 shadow-sm dark:bg-slate-900 ${snap.isDragging ? 'shadow-lg rotate-1' : ''}`}
                        >
                          <p className="text-sm font-medium leading-tight">{job.company}</p>
                          <p className="mt-0.5 text-xs text-slate-500">{job.position}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="text-xs text-slate-400">{formatDate(job.appliedAt)}</span>
                            <div className="flex gap-1">
                              {job.url && (
                                <a href={job.url} target="_blank" rel="noopener noreferrer" className="rounded p-1 text-slate-400 hover:text-indigo-600">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <button onClick={() => onEdit(job)} className="rounded p-1 text-slate-400 hover:text-indigo-600">
                                <Pencil className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        ))}
      </div>
    </DragDropContext>
  );
}
