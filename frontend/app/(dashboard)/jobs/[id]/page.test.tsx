import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JobDetailPage from './page';
import { formatDateOnly } from '../../../../lib/utils';
import type { Job, JobEvent } from '../../../../types';

const replace = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'j-1' }),
  useRouter: () => ({ replace, push }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

vi.mock('../../../../components/jobs/job-form', () => ({
  JobForm: ({ open, job }: { open: boolean; job?: Job }) =>
    open ? <div data-testid="job-form" data-job-id={job?.id ?? ''} /> : null,
}));

vi.mock('../../../../components/jobs/resume-upload', () => ({
  ResumeUpload: ({ jobId }: { jobId: string }) => (
    <div data-testid="resume-upload" data-job-id={jobId} />
  ),
}));

vi.mock('../../../../components/jobs/interview-rounds', () => ({
  InterviewRounds: ({ jobId, rounds }: { jobId: string; rounds: unknown[] }) => (
    <div data-testid="interview-rounds" data-job-id={jobId} data-count={rounds.length} />
  ),
}));

vi.mock('../../../../components/jobs/contacts', () => ({
  Contacts: ({ jobId, contacts }: { jobId: string; contacts: unknown[] }) => (
    <div data-testid="contacts" data-job-id={jobId} data-count={contacts.length} />
  ),
}));

vi.mock('../../../../components/company-profile-card', () => ({
  CompanyProfileCard: ({ invalidateKey }: { invalidateKey: unknown[] }) => (
    <div data-testid="company-profile-card" data-job-id={invalidateKey[1]} />
  ),
}));

import api from '../../../../lib/api';
import { toast } from 'sonner';

const job: Job = {
  id: 'j-1',
  company: 'Acme',
  position: 'Senior Engineer',
  location: 'Austin, TX',
  url: 'https://acme.example/jobs/1',
  status: 'INTERVIEWING',
  priority: 'HIGH',
  jobType: 'REMOTE',
  discoverySource: 'LINKEDIN',
  applicationChannel: 'REFERRAL',
  notes: 'Great referral from Bob',
  appliedAt: '2026-06-01T00:00:00Z',
  nextInterviewAt: '2026-06-15T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  userId: 'u-1',
  interviewRounds: [],
  contacts: [],
};

function mockJobAndEvents(jobData: Job | undefined, events: JobEvent[] = []) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/jobs/j-1') {
      return jobData
        ? Promise.resolve({ data: jobData })
        : Promise.reject({ isAxiosError: true, response: { status: 404 } });
    }
    if (url === '/jobs/j-1/events') {
      return Promise.resolve({
        data: {
          data: events,
          meta: { total: events.length, page: 1, limit: 50, totalPages: 1 },
        },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <JobDetailPage />
    </QueryClientProvider>,
  );
  return { qc };
}

describe('JobDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows skeletons while the job query is pending', () => {
      vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
      const { container } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <JobDetailPage />
        </QueryClientProvider>,
      );
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
  });

  describe('not found', () => {
    it('shows "Job not found." on a 404', async () => {
      mockJobAndEvents(undefined);
      renderPage();
      expect(await screen.findByText('Job not found.')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows "Failed to load job." (not "Job not found.") on a non-404 failure', async () => {
      vi.mocked(api.get).mockImplementation((url: string) => {
        if (url === '/jobs/j-1') return Promise.reject(new Error('network down'));
        if (url === '/jobs/j-1/events')
          return Promise.resolve({
            data: { data: [], meta: { total: 0, page: 1, limit: 50, totalPages: 0 } },
          });
        return Promise.reject(new Error(`unexpected GET ${url}`));
      });
      renderPage();
      expect(await screen.findByText('Failed to load job.')).toBeInTheDocument();
      expect(screen.queryByText('Job not found.')).not.toBeInTheDocument();
    });
  });

  describe('detail rendering', () => {
    it('renders company, position, status, applied date, and next interview', async () => {
      mockJobAndEvents(job);
      renderPage();
      expect(await screen.findByText('Acme')).toBeInTheDocument();
      expect(screen.getByText('Senior Engineer')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Interviewing')).toBeInTheDocument();
      expect(screen.getByText(formatDateOnly('2026-06-01T00:00:00Z'))).toBeInTheDocument();
      expect(screen.getByText(formatDateOnly('2026-06-15T00:00:00Z'))).toBeInTheDocument();
      expect(screen.getByText('Austin, TX')).toBeInTheDocument();
      expect(screen.getByText('Great referral from Bob')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /open link/i })).toHaveAttribute(
        'href',
        'https://acme.example/jobs/1',
      );
    });

    it('omits optional fields when absent', async () => {
      mockJobAndEvents({
        ...job,
        location: undefined,
        url: undefined,
        notes: undefined,
        nextInterviewAt: undefined,
        discoverySource: null,
        applicationChannel: null,
      });
      renderPage();
      await screen.findByText('Acme');
      expect(screen.queryByText('Next Interview')).not.toBeInTheDocument();
      expect(screen.queryByText('Location')).not.toBeInTheDocument();
      expect(screen.queryByText('Job Posting')).not.toBeInTheDocument();
      expect(screen.queryByText('Notes')).not.toBeInTheDocument();
      expect(screen.queryByText('Discovery Source')).not.toBeInTheDocument();
      expect(screen.queryByText('Application Channel')).not.toBeInTheDocument();
    });

    it('passes ids/counts down to child sections', async () => {
      mockJobAndEvents({
        ...job,
        interviewRounds: [
          {
            id: 'r-1',
            jobId: 'j-1',
            stage: 'Screen',
            scheduledAt: '2026-06-05T00:00:00Z',
            outcome: 'PENDING',
            derivedStatus: 'SCHEDULED',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
          },
        ],
        contacts: [
          {
            id: 'c-1',
            jobId: 'j-1',
            name: 'Jane',
            createdAt: '2026-06-01T00:00:00Z',
            updatedAt: '2026-06-01T00:00:00Z',
          },
        ],
      });
      renderPage();
      await screen.findByText('Acme');
      expect(screen.getByTestId('resume-upload')).toHaveAttribute('data-job-id', 'j-1');
      expect(screen.getByTestId('interview-rounds')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('contacts')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('company-profile-card')).toHaveAttribute('data-job-id', 'j-1');
    });
  });

  describe('timeline', () => {
    it('renders nothing when there are no events', async () => {
      mockJobAndEvents(job, []);
      renderPage();
      await screen.findByText('Acme');
      expect(screen.queryByText('Timeline')).not.toBeInTheDocument();
    });

    it('renders CREATED, STATUS_CHANGE, and INTERVIEW_ROUND_ADDED events', async () => {
      mockJobAndEvents(job, [
        {
          id: 'e-1',
          jobId: 'j-1',
          type: 'CREATED',
          toStatus: 'WISHLIST',
          createdAt: '2026-06-01T00:00:00Z',
        },
        {
          id: 'e-2',
          jobId: 'j-1',
          type: 'STATUS_CHANGE',
          fromStatus: 'WISHLIST',
          toStatus: 'APPLIED',
          note: 'Submitted via referral',
          createdAt: '2026-06-02T00:00:00Z',
        },
        {
          id: 'e-3',
          jobId: 'j-1',
          type: 'INTERVIEW_ROUND_ADDED',
          toStatus: 'INTERVIEWING',
          createdAt: '2026-06-03T00:00:00Z',
        },
      ]);
      renderPage();
      await screen.findByText('Acme');
      expect(screen.getByText('Timeline')).toBeInTheDocument();
      expect(screen.getByText('Application created')).toBeInTheDocument();
      expect(screen.getByText(/status changed from/i)).toBeInTheDocument();
      expect(screen.getByText('→ Submitted via referral')).toBeInTheDocument();
      expect(screen.getByText('Interview round scheduled')).toBeInTheDocument();
    });
  });

  describe('status change', () => {
    it('patches the status and invalidates dependent queries', async () => {
      mockJobAndEvents(job);
      vi.mocked(api.patch).mockResolvedValue({ data: { ...job, status: 'OFFER' } });
      const { qc } = renderPage();
      const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
      await screen.findByText('Acme');
      fireEvent.change(screen.getByDisplayValue('Interviewing'), {
        target: { value: 'OFFER' },
      });
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/jobs/j-1', {
          status: 'OFFER',
        }),
      );
      await waitFor(() => expect(screen.getByDisplayValue('Offer')).toBeInTheDocument());
      const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
      expect(invalidatedKeys).toEqual(
        expect.arrayContaining(['job-events', 'jobs', 'stats', 'analytics', 'attention']),
      );
    });

    it('shows the server error and refetches on a 409 conflict', async () => {
      mockJobAndEvents(job);
      vi.mocked(api.patch).mockRejectedValue({
        isAxiosError: true,
        response: { status: 409, data: { message: 'Status changed concurrently' } },
      });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.change(screen.getByDisplayValue('Interviewing'), {
        target: { value: 'OFFER' },
      });
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Status changed concurrently',
        ),
      );
      // Refetch after the conflict re-fetches /jobs/j-1 beyond the initial load.
      await waitFor(() =>
        expect(
          vi.mocked(api.get).mock.calls.filter((c) => c[0] === '/jobs/j-1').length,
        ).toBeGreaterThan(1),
      );
    });
  });

  describe('delete flow', () => {
    it('deletes and redirects to /jobs on success', async () => {
      mockJobAndEvents(job);
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/jobs/j-1'),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Job deleted');
      expect(replace).toHaveBeenCalledWith('/jobs');
    });

    it('shows an error toast and does not redirect when delete fails', async () => {
      mockJobAndEvents(job);
      vi.mocked(api.delete).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Job has linked interview rounds' } },
      });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Job has linked interview rounds',
        ),
      );
      expect(replace).not.toHaveBeenCalled();
    });
  });

  describe('edit', () => {
    it('opens JobForm pre-filled with the current job on Edit', async () => {
      mockJobAndEvents(job);
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      expect(screen.getByTestId('job-form')).toHaveAttribute('data-job-id', 'j-1');
    });
  });
});
