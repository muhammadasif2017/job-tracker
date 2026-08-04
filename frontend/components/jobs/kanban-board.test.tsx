import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { KanbanBoard } from './kanban-board';
import type {
  DropResult,
  DroppableProvided,
  DroppableStateSnapshot,
  DraggableProvided,
  DraggableStateSnapshot,
} from '@hello-pangea/dnd';
import type { Job, PaginatedJobs } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn() },
  getErrorMessage: (err: unknown, fallback: string) => {
    const axiosErr = err as {
      isAxiosError?: boolean;
      response?: { data?: { message?: unknown } };
    };
    if (!axiosErr?.isAxiosError) return fallback;
    const message = axiosErr.response?.data?.message;
    if (Array.isArray(message)) return message.join('. ');
    return typeof message === 'string' ? message : fallback;
  },
}));

let capturedOnDragEnd: ((result: DropResult) => void) | undefined;

vi.mock('@hello-pangea/dnd', () => ({
  DragDropContext: ({
    children,
    onDragEnd,
  }: {
    children: React.ReactNode;
    onDragEnd: (result: DropResult) => void;
  }) => {
    capturedOnDragEnd = onDragEnd;
    return children;
  },
  Droppable: ({
    children,
  }: {
    children: (
      provided: DroppableProvided,
      snapshot: DroppableStateSnapshot,
    ) => React.ReactNode;
  }) =>
    children(
      { innerRef: () => {}, droppableProps: {}, placeholder: null } as unknown as DroppableProvided,
      { isDraggingOver: false } as unknown as DroppableStateSnapshot,
    ),
  Draggable: ({
    children,
  }: {
    children: (
      provided: DraggableProvided,
      snapshot: DraggableStateSnapshot,
    ) => React.ReactNode;
  }) =>
    children(
      { innerRef: () => {}, draggableProps: {}, dragHandleProps: {} } as unknown as DraggableProvided,
      { isDragging: false } as unknown as DraggableStateSnapshot,
    ),
}));

import api from '../../lib/api';
import { toast } from 'sonner';

const JOBS_KEY = ['jobs', { limit: 100 }];

function makeJob(overrides: Partial<Job>): Job {
  return {
    id: 'j-1',
    company: 'Acme',
    position: 'Engineer',
    status: 'APPLIED',
    priority: 'MEDIUM',
    jobType: 'REMOTE',
    appliedAt: '2026-06-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    userId: 'u-1',
    ...overrides,
  };
}

function paginated(data: Job[]): PaginatedJobs {
  return { data, meta: { total: data.length, page: 1, limit: 100, totalPages: 1 } };
}

function renderBoard(jobs: Job[], onEdit = vi.fn()) {
  vi.mocked(api.get).mockResolvedValue({ data: paginated(jobs) });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <KanbanBoard onEdit={onEdit} />
    </QueryClientProvider>,
  );
  return { qc, invalidateSpy, onEdit };
}

describe('KanbanBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnDragEnd = undefined;
  });

  it('shows skeletons while loading', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <KanbanBoard onEdit={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
  });

  it('shows a failed-to-load message with a retry button when the query errors', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <KanbanBoard onEdit={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Failed to load board')).toBeInTheDocument();
    expect(screen.queryByText('Wishlist')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows only the four active-pipeline columns', async () => {
    renderBoard([]);
    await waitFor(() => expect(screen.getByText('Wishlist')).toBeInTheDocument());
    expect(screen.getByText('Applied')).toBeInTheDocument();
    expect(screen.getByText('Interviewing')).toBeInTheDocument();
    expect(screen.getByText('Offer')).toBeInTheDocument();
    expect(screen.queryByText('Rejected')).not.toBeInTheDocument();
    expect(screen.queryByText('Ghosted')).not.toBeInTheDocument();
  });

  it('places jobs in the correct column and excludes REJECTED/GHOSTED', async () => {
    const jobs = [
      makeJob({ id: 'j-wishlist', company: 'WishCo', status: 'WISHLIST' }),
      makeJob({ id: 'j-applied', company: 'AppliedCo', status: 'APPLIED' }),
      makeJob({ id: 'j-interviewing', company: 'IntCo', status: 'INTERVIEWING' }),
      makeJob({ id: 'j-offer', company: 'OfferCo', status: 'OFFER' }),
      makeJob({ id: 'j-rejected', company: 'RejectedCo', status: 'REJECTED' }),
      makeJob({ id: 'j-ghosted', company: 'GhostedCo', status: 'GHOSTED' }),
    ];
    renderBoard(jobs);
    await waitFor(() => expect(screen.getByText('WishCo')).toBeInTheDocument());
    expect(screen.getByText('AppliedCo')).toBeInTheDocument();
    expect(screen.getByText('IntCo')).toBeInTheDocument();
    expect(screen.getByText('OfferCo')).toBeInTheDocument();
    expect(screen.queryByText('RejectedCo')).not.toBeInTheDocument();
    expect(screen.queryByText('GhostedCo')).not.toBeInTheDocument();
  });

  it('shows the count badge per column', async () => {
    const jobs = [
      makeJob({ id: 'j-1', status: 'APPLIED' }),
      makeJob({ id: 'j-2', status: 'APPLIED' }),
      makeJob({ id: 'j-3', status: 'OFFER' }),
    ];
    renderBoard(jobs);
    await waitFor(() => expect(screen.getByText('Applied')).toBeInTheDocument());
    // Scope to the count badge itself (`.ml-auto` in the column header), not
    // the whole column div — the column also contains card text (dates,
    // company names) that can coincidentally contain the expected digit.
    const header = screen.getByText('Applied').closest('div')!;
    const badge = header.querySelector('.ml-auto')!;
    expect(badge.textContent).toBe('2');
  });

  it('renders the external link only when job.url is set', async () => {
    const jobs = [
      makeJob({ id: 'with-url', company: 'HasUrl', url: 'https://x.example' }),
      makeJob({ id: 'without-url', company: 'NoUrl' }),
    ];
    renderBoard(jobs);
    await waitFor(() => expect(screen.getByText('HasUrl')).toBeInTheDocument());
    expect(
      screen.getByLabelText('View job posting for HasUrl'),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText('View job posting for NoUrl'),
    ).not.toBeInTheDocument();
  });

  it('calls onEdit with the job when the edit button is clicked', async () => {
    const job = makeJob({ id: 'j-edit', company: 'EditCo' });
    const { onEdit } = renderBoard([job]);
    await waitFor(() => expect(screen.getByText('EditCo')).toBeInTheDocument());
    screen.getByLabelText('Edit EditCo').click();
    expect(onEdit).toHaveBeenCalledWith(job);
  });

  describe('drag and drop', () => {
    it('optimistically updates the cache and calls the patch API', async () => {
      const job = makeJob({ id: 'j-drag', company: 'DragCo', status: 'APPLIED' });
      const { qc, invalidateSpy } = renderBoard([job]);
      await waitFor(() => expect(screen.getByText('DragCo')).toBeInTheDocument());

      let resolvePatch!: (value: { data: unknown }) => void;
      vi.mocked(api.patch).mockReturnValue(
        new Promise((resolve) => {
          resolvePatch = resolve;
        }) as ReturnType<typeof api.patch>,
      );

      capturedOnDragEnd!({
        destination: { droppableId: 'INTERVIEWING', index: 0 },
        source: { droppableId: 'APPLIED', index: 0 },
        draggableId: 'j-drag',
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      } as unknown as DropResult);

      await waitFor(() => {
        const cached = qc.getQueryData<PaginatedJobs>(JOBS_KEY);
        expect(cached?.data.find((j) => j.id === 'j-drag')?.status).toBe(
          'INTERVIEWING',
        );
      });
      expect(api.patch).toHaveBeenCalledWith('/jobs/j-drag', {
        status: 'INTERVIEWING',
      });

      resolvePatch({ data: { ...job, status: 'INTERVIEWING' } });
      await waitFor(() => {
        const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
        expect(keys).toContainEqual(['jobs']);
      });
    });

    it('rolls back the cache and shows an error toast when the patch fails', async () => {
      const job = makeJob({ id: 'j-fail', company: 'FailCo', status: 'APPLIED' });
      // onSettled always invalidates ['jobs'], which would refetch through
      // api.get and could coincidentally restore APPLIED even if the onError
      // rollback were deleted. Make every GET after the first mount hang, so
      // the only way the cache can show APPLIED again is the rollback itself.
      vi.mocked(api.get)
        .mockResolvedValueOnce({ data: paginated([job]) })
        .mockReturnValue(new Promise(() => {}));
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={qc}>
          <KanbanBoard onEdit={vi.fn()} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(screen.getByText('FailCo')).toBeInTheDocument());

      vi.mocked(api.patch).mockRejectedValue(new Error('network error'));

      capturedOnDragEnd!({
        destination: { droppableId: 'OFFER', index: 0 },
        source: { droppableId: 'APPLIED', index: 0 },
        draggableId: 'j-fail',
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      } as unknown as DropResult);

      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to update status',
        ),
      );
      const cached = qc.getQueryData<PaginatedJobs>(JOBS_KEY);
      expect(cached?.data.find((j) => j.id === 'j-fail')?.status).toBe(
        'APPLIED',
      );
    });

    it('invalidates jobs, stats, funnel, and attention queries on settle', async () => {
      const job = makeJob({ id: 'j-settle', status: 'APPLIED' });
      const { invalidateSpy } = renderBoard([job]);
      await waitFor(() => expect(capturedOnDragEnd).toBeDefined());

      vi.mocked(api.patch).mockResolvedValue({ data: { ...job, status: 'OFFER' } });

      capturedOnDragEnd!({
        destination: { droppableId: 'OFFER', index: 0 },
        source: { droppableId: 'APPLIED', index: 0 },
        draggableId: 'j-settle',
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      } as unknown as DropResult);

      await waitFor(() => {
        const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
        expect(keys).toContainEqual(['jobs']);
        expect(keys).toContainEqual(['stats']);
        expect(keys).toContainEqual(['analytics', 'funnel']);
        expect(keys).toContainEqual(['attention']);
      });
    });

    it('does not call the patch API when there is no destination', async () => {
      const job = makeJob({ id: 'j-noop', status: 'APPLIED' });
      renderBoard([job]);
      await waitFor(() => expect(capturedOnDragEnd).toBeDefined());

      capturedOnDragEnd!({
        destination: null,
        source: { droppableId: 'APPLIED', index: 0 },
        draggableId: 'j-noop',
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      } as unknown as DropResult);

      expect(api.patch).not.toHaveBeenCalled();
    });

    it('does not call the patch API when dropped in the same column', async () => {
      const job = makeJob({ id: 'j-same', status: 'APPLIED' });
      renderBoard([job]);
      await waitFor(() => expect(capturedOnDragEnd).toBeDefined());

      capturedOnDragEnd!({
        destination: { droppableId: 'APPLIED', index: 0 },
        source: { droppableId: 'APPLIED', index: 0 },
        draggableId: 'j-same',
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      } as unknown as DropResult);

      expect(api.patch).not.toHaveBeenCalled();
    });
  });
});
