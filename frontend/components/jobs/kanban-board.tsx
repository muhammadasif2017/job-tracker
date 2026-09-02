'use client';

import { useMemo } from 'react';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import { Pencil, ExternalLink } from 'lucide-react';
import { Skeleton, LoadingStatus } from '../ui/skeleton';
import { Button } from '../ui/button';
import { formatDateOnly } from '../../lib/utils';
import { STATUS_LABELS, STATUS_DOT_COLORS, type Job, type JobStatus } from '../../types';
import {
  useKanbanJobsQuery,
  useKanbanPatchStatusMutation,
  kanbanStatuses,
  KANBAN_STATUSES,
  KANBAN_PAGE_SIZE,
  type JobsFilterValues,
} from '../../features/jobs/hooks';

const KANBAN_COLS: JobStatus[] = KANBAN_STATUSES;

interface KanbanBoardProps {
  onEdit: (job: Job) => void;
  // The page's filters, honoured here too — the board used to fetch
  // unfiltered, so switching from a filtered list to the board silently
  // showed every open application again.
  filters: JobsFilterValues;
}

export function KanbanBoard({ onEdit, filters }: KanbanBoardProps) {
  const { data, isLoading, isError, refetch } = useKanbanJobsQuery(filters);
  const patchStatus = useKanbanPatchStatusMutation(filters);
  // Empty when the status filter names a stage the board has no column for.
  const selectableStatuses = kanbanStatuses(filters.status);

  // The board fetches a single page. When more open applications match than
  // fit in it, say so — silently rendering a subset of the pipeline is worse
  // than an incomplete board the user knows is incomplete.
  const loaded = data?.data.length ?? 0;
  const hiddenCount = Math.max((data?.meta.total ?? 0) - loaded, 0);

  const jobsByStatus = useMemo(
    () =>
      KANBAN_COLS.reduce(
        (acc, s) => ({
          ...acc,
          [s]: data?.data.filter((j) => j.status === s) ?? [],
        }),
        {} as Record<JobStatus, Job[]>,
      ),
    [data],
  );

  const onDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const newStatus = result.destination.droppableId as JobStatus;
    const jobId = result.draggableId;
    const job = data?.data.find((j) => j.id === jobId);
    if (job && job.status !== newStatus) {
      patchStatus.mutate({ id: jobId, status: newStatus });
    }
  };

  if (selectableStatuses.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-line bg-paper py-16 text-center">
        <p className="text-base font-medium text-ink">
          {STATUS_LABELS[filters.status as JobStatus]} isn&apos;t a board
          column
        </p>
        <p className="text-sm text-muted-2">
          The board shows the open pipeline only. Switch to list view to see
          these applications.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <LoadingStatus label="Loading jobs" className="flex gap-4 overflow-x-auto pb-4">
        {KANBAN_COLS.map((col) => (
          <div key={col} className="w-64 shrink-0 space-y-3">
            <Skeleton className="h-6 w-32" />
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ))}
      </LoadingStatus>
    );
  }

  if (isError && !data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-line bg-paper py-16 text-center">
        <p className="text-base font-medium text-danger">
          Failed to load board
        </p>
        <p className="text-sm text-muted-2">
          Check your connection and try again.
        </p>
        <Button variant="secondary" size="sm" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      {hiddenCount > 0 && (
        <p className="mb-3 rounded-md border border-line bg-paper px-3 py-2 text-sm text-muted">
          Showing the {KANBAN_PAGE_SIZE} most recent open applications.{' '}
          {hiddenCount} more {hiddenCount === 1 ? 'is' : 'are'} not on the
          board — use the list view to see everything.
        </p>
      )}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {selectableStatuses.map((col) => (
          <div key={col} className="w-64 shrink-0">
            <div className="relative mb-3 flex items-center gap-2 border-b-2 border-dashed border-line pb-3">
              <span
                className="relative z-10 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-surface"
                style={{ background: STATUS_DOT_COLORS[col] }}
              />
              <span className="font-mono text-xs font-medium uppercase tracking-wide text-ink">
                {STATUS_LABELS[col]}
              </span>
              <span className="ml-auto rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-[11px] text-muted">
                {jobsByStatus[col].length}
              </span>
            </div>
            <Droppable droppableId={col}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`min-h-20 space-y-2 rounded-md p-2 transition-colors ${snapshot.isDraggingOver ? 'bg-accent-soft' : ''}`}
                >
                  {jobsByStatus[col].map((job, idx) => (
                    <Draggable key={job.id} draggableId={job.id} index={idx}>
                      {(drag, snap) => (
                        <div
                          ref={drag.innerRef}
                          {...drag.draggableProps}
                          {...drag.dragHandleProps}
                          className={`rounded-md border border-line bg-paper p-3 shadow-sm ${snap.isDragging ? 'shadow-lg rotate-1' : ''}`}
                          style={{ borderLeft: `3px solid ${STATUS_DOT_COLORS[col]}` }}
                        >
                          <p className="text-sm font-medium leading-tight break-words text-ink">
                            {job.company}
                          </p>
                          <p className="mt-0.5 text-xs text-muted break-words">
                            {job.position}
                          </p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="font-mono text-[11px] text-muted-2">
                              {formatDateOnly(job.appliedAt)}
                            </span>
                            <div className="flex gap-1">
                              {job.url && (
                                <a
                                  href={job.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-label={`View job posting for ${job.company}`}
                                  className="rounded p-1 text-muted-2 hover:text-accent"
                                >
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              )}
                              <button
                                onClick={() => onEdit(job)}
                                aria-label={`Edit ${job.company}`}
                                className="rounded p-1 text-muted-2 hover:text-accent"
                              >
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
