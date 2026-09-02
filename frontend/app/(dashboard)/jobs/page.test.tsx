import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JobsPage from './page';
import { formatDateOnly } from '../../../lib/utils';
import type { Job, PaginatedJobs } from '../../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
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

vi.mock('../../../components/jobs/job-form', () => ({
  JobForm: ({ open, onClose, job }: { open: boolean; onClose: () => void; job?: Job }) =>
    open ? (
      <div data-testid="job-form" data-job-id={job?.id ?? ''}>
        <button onClick={onClose}>close-job-form</button>
      </div>
    ) : null,
}));

vi.mock('../../../components/jobs/quick-add', () => ({
  QuickAdd: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
    open ? (
      <div data-testid="quick-add">
        <button onClick={onClose}>close-quick-add</button>
      </div>
    ) : null,
}));

vi.mock('../../../components/jobs/kanban-board', () => ({
  KanbanBoard: ({ onEdit }: { onEdit: (job: Job) => void }) => (
    <div data-testid="kanban-board">
      <button onClick={() => onEdit(jobs[0])}>kanban-edit</button>
    </div>
  ),
}));

import api from '../../../lib/api';
import { toast } from 'sonner';

const jobs: Job[] = [
  {
    id: 'j-1',
    company: 'Acme',
    position: 'Senior Engineer',
    location: 'Austin, TX',
    url: 'https://acme.example/jobs/1',
    status: 'INTERVIEWING',
    priority: 'HIGH',
    jobType: 'REMOTE',
    applicationChannel: 'REFERRAL',
    appliedAt: '2026-06-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    userId: 'u-1',
  },
  {
    id: 'j-2',
    company: 'Globex',
    position: 'Product Manager',
    status: 'APPLIED',
    priority: 'MEDIUM',
    jobType: 'ONSITE',
    appliedAt: '2026-05-15T00:00:00Z',
    createdAt: '2026-05-15T00:00:00Z',
    updatedAt: '2026-05-15T00:00:00Z',
    userId: 'u-1',
  },
];

function page(overrides: Partial<PaginatedJobs> = {}): PaginatedJobs {
  return {
    data: jobs,
    meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <JobsPage />
    </QueryClientProvider>,
  );
}

function lastGetUrl() {
  const calls = vi.mocked(api.get).mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe('JobsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows skeleton rows while the query is pending', () => {
      vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
      const { container } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <JobsPage />
        </QueryClientProvider>,
      );
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
  });

  describe('empty state', () => {
    it('shows "No jobs found" when there are no jobs', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page({ data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }) });
      renderPage();
      expect(await screen.findByText('No jobs found')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows a failed-to-load message instead of an empty table when the query errors', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('network down'));
      renderPage();
      expect(await screen.findByText('Failed to load jobs')).toBeInTheDocument();
      expect(screen.queryByText('No jobs found')).not.toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === 'Failed to load'),
      ).toBeInTheDocument();
    });
  });

  describe('list rendering', () => {
    it('renders job rows with company, position link, badges, date, and location', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      expect(await screen.findByText('Acme')).toBeInTheDocument();
      const posLink = screen.getByRole('link', { name: 'Senior Engineer' });
      expect(posLink).toHaveAttribute('href', '/jobs/j-1');
      const row = within(posLink.closest('tr')!);
      expect(row.getByText('Interviewing')).toBeInTheDocument();
      expect(row.getByText('High')).toBeInTheDocument();
      expect(row.getByText('Remote')).toBeInTheDocument();
      expect(row.getByText('Austin, TX')).toBeInTheDocument();
      expect(row.getByText(formatDateOnly('2026-06-01T00:00:00Z'))).toBeInTheDocument();
      expect(
        screen.getByText((_, el) => el?.textContent === '2 applications tracked'),
      ).toBeInTheDocument();
    });

    it('shows a dash for missing channel/location and no external-link icon without a url', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Globex');
      expect(
        screen.queryByRole('link', { name: /view job posting for globex/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /view job posting for acme/i }),
      ).toHaveAttribute('href', 'https://acme.example/jobs/1');
    });
  });

  describe('search and filters', () => {
    it('debounces search input into the query params', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.change(screen.getByLabelText('Search jobs'), {
        target: { value: 'engineer' },
      });
      await waitFor(() => expect(lastGetUrl()).toContain('search=engineer'), {
        timeout: 1000,
      });
    });

    it('filters by status', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.change(screen.getByLabelText('Filter by status'), {
        target: { value: 'OFFER' },
      });
      await waitFor(() => expect(lastGetUrl()).toContain('status=OFFER'));
    });

    it('filters by priority', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.change(screen.getByLabelText('Filter by priority'), {
        target: { value: 'LOW' },
      });
      await waitFor(() => expect(lastGetUrl()).toContain('priority=LOW'));
    });
  });

  describe('view toggle', () => {
    it('switches between list and board view', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /board/i }));
      expect(screen.getByTestId('kanban-board')).toBeInTheDocument();
      expect(screen.queryByText('Acme')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /^list$/i }));
      expect(await screen.findByText('Acme')).toBeInTheDocument();
      expect(screen.queryByTestId('kanban-board')).not.toBeInTheDocument();
    });

    it('opens JobForm pre-filled when editing from the Kanban board', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /board/i }));
      fireEvent.click(screen.getByRole('button', { name: /kanban-edit/i }));
      expect(screen.getByTestId('job-form')).toHaveAttribute('data-job-id', 'j-1');
    });
  });

  describe('add / edit wiring', () => {
    it('opens a blank JobForm on Add Job', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /add job/i }));
      expect(screen.getByTestId('job-form')).toHaveAttribute('data-job-id', '');
    });

    it('opens QuickAdd on Quick Add', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /quick add/i }));
      expect(screen.getByTestId('quick-add')).toBeInTheDocument();
    });

    it('opens JobForm pre-filled with the clicked row on Edit', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: 'Edit Globex' }));
      expect(screen.getByTestId('job-form')).toHaveAttribute('data-job-id', 'j-2');
    });
  });

  describe('delete flow', () => {
    it('cancels without deleting', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
      expect(await screen.findByText('Delete job?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() =>
        expect(screen.queryByText('Delete job?')).not.toBeInTheDocument(),
      );
      expect(vi.mocked(api.delete)).not.toHaveBeenCalled();
    });

    it('deletes on confirm and shows a success toast', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
      await screen.findByText('Delete job?');
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/jobs/j-1'),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Job deleted');
    });

    it('shows an error toast and keeps the modal open when delete fails', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      vi.mocked(api.delete).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Job has linked interview rounds' } },
      });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: 'Delete Acme' }));
      await screen.findByText('Delete job?');
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Job has linked interview rounds',
        ),
      );
      expect(screen.getByText('Delete job?')).toBeInTheDocument();
    });
  });

  describe('export', () => {
    it('downloads a CSV on Export CSV', async () => {
      const createObjectURL = vi.fn().mockReturnValue('blob:mock');
      const revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.startsWith('/jobs/export')) {
          return Promise.resolve({ data: new Blob(['csv']) });
        }
        return Promise.resolve({ data: page() });
      });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
      await waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      expect(clickSpy).toHaveBeenCalled();

      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('warns when the server truncated the export and uses its filename', async () => {
      // X-Export-Truncated is the only signal that the download hit the row
      // cap; Content-Disposition carries the status-suffixed filename. Both
      // are readable cross-origin only because main.ts lists them in the CORS
      // exposedHeaders.
      const createObjectURL = vi.fn().mockReturnValue('blob:mock');
      const revokeObjectURL = vi.fn();
      vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});
      const downloads: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'download', 'set').mockImplementation(
        function (this: HTMLAnchorElement, value: string) {
          downloads.push(value);
        },
      );

      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.startsWith('/jobs/export')) {
          return Promise.resolve({
            data: new Blob(['csv']),
            headers: {
              'content-disposition': 'attachment; filename="jobs-offer.csv"',
              'x-export-truncated': 'true',
            },
          });
        }
        return Promise.resolve({ data: page() });
      });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

      await waitFor(() =>
        expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
          expect.stringContaining('truncated'),
        ),
      );
      expect(downloads).toContain('jobs-offer.csv');

      clickSpy.mockRestore();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    });

    it('shows an error toast when export fails', async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url.startsWith('/jobs/export')) {
          return Promise.reject(new Error('network error'));
        }
        return Promise.resolve({ data: page() });
      });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /export csv/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Export failed'),
      );
    });
  });

  describe('pagination', () => {
    it('disables Previous on the first page and Next on the last', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: page({ meta: { total: 20, page: 1, limit: 10, totalPages: 2 } }),
      });
      renderPage();
      await screen.findByText('Acme');
      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
      await waitFor(() => expect(lastGetUrl()).toContain('page=2'));
      expect(await screen.findByText('Acme')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
    });
  });
});
