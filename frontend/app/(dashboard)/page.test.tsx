import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import DashboardPage from './page';
import type { JobStats, FunnelStats, TrendStats, PaginatedJobs, Job } from '../../types';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
}));

import api from '../../lib/api';

function makeStats(overrides: Partial<JobStats> = {}): JobStats {
  return {
    total: 12,
    byStatus: {
      WISHLIST: 2,
      APPLIED: 5,
      INTERVIEWING: 2,
      OFFER: 1,
      REJECTED: 1,
      GHOSTED: 1,
    },
    thisMonth: 3,
    responseRate: 40,
    ghostRate: 8,
    ...overrides,
  };
}

function makeFunnel(): FunnelStats {
  return {
    funnel: [
      { status: 'WISHLIST', reached: 0 },
      { status: 'APPLIED', reached: 0 },
      { status: 'INTERVIEWING', reached: 0 },
      { status: 'OFFER', reached: 0 },
    ],
    dropoff: [
      { status: 'REJECTED', count: 0 },
      { status: 'GHOSTED', count: 0 },
    ],
    avgTimeInStageDays: {},
    responseRateBySource: [],
  };
}

function makeTrend(): TrendStats {
  return { granularity: 'week', buckets: [] };
}

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j-1',
    company: 'Acme Corp',
    position: 'Backend Engineer',
    status: 'APPLIED',
    priority: 'MEDIUM',
    jobType: 'ONSITE',
    appliedAt: '2026-01-01T00:00:00Z',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    userId: 'u-1',
    ...overrides,
  };
}

function makeRecent(jobs: Job[] = []): PaginatedJobs {
  return { data: jobs, meta: { total: jobs.length, page: 1, limit: 5, totalPages: 1 } };
}

function mockApiRoutes({
  stats = makeStats(),
  funnel = makeFunnel(),
  trend = makeTrend(),
  recent = makeRecent(),
  attention = [],
}: {
  stats?: JobStats | Promise<never>;
  funnel?: FunnelStats;
  trend?: TrendStats;
  recent?: PaginatedJobs;
  attention?: unknown[];
} = {}) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.startsWith('/jobs/stats/funnel')) return Promise.resolve({ data: funnel });
    if (url.startsWith('/jobs/stats/trend')) return Promise.resolve({ data: trend });
    if (url.startsWith('/jobs/stats')) return Promise.resolve({ data: stats });
    if (url.startsWith('/jobs/attention')) return Promise.resolve({ data: attention });
    if (url.startsWith('/jobs')) return Promise.resolve({ data: recent });
    return Promise.reject(new Error(`unhandled url: ${url}`));
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeletons for the stat cards while loading', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders stat values once stats load', async () => {
    mockApiRoutes({ stats: makeStats({ total: 12, thisMonth: 3, responseRate: 40, ghostRate: 8 }) });
    renderPage();

    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
  });

  it('shows a failure message in the status chart card when stats fail', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/jobs/stats') && !url.includes('funnel') && !url.includes('trend')) {
        return Promise.reject(new Error('network error'));
      }
      if (url.startsWith('/jobs/stats/funnel')) return Promise.resolve({ data: makeFunnel() });
      if (url.startsWith('/jobs/stats/trend')) return Promise.resolve({ data: makeTrend() });
      if (url.startsWith('/jobs/attention')) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: makeRecent() });
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Failed to load chart.')).toBeInTheDocument());
  });

  it('shows the empty state with a link to add a job when there is no recent activity', async () => {
    mockApiRoutes({ recent: makeRecent([]) });
    renderPage();

    await waitFor(() => expect(screen.getByText('No jobs tracked yet.')).toBeInTheDocument());
    expect(
      screen.getByRole('link', { name: /add your first application/i }),
    ).toHaveAttribute('href', '/jobs');
  });

  it('lists recent jobs with company, position, status, and applied date', async () => {
    mockApiRoutes({
      recent: makeRecent([
        makeJob({ id: 'j-1', company: 'Acme Corp', position: 'Backend Engineer', appliedAt: '2026-01-05T00:00:00Z' }),
      ]),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(screen.getByText('Backend Engineer')).toBeInTheDocument();
    expect(screen.getByText('Jan 5, 2026')).toBeInTheDocument();
  });

  it('shows the timeline summary caption when present', async () => {
    mockApiRoutes({
      recent: makeRecent([
        makeJob({
          id: 'j-1',
          company: 'Acme Corp',
          position: 'Backend Engineer',
          timelineSummary: 'Applied, then moved to interviewing.',
        }),
      ]),
    });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText('Applied, then moved to interviewing.'),
      ).toBeInTheDocument(),
    );
  });

  it('omits the timeline summary caption when not yet generated', async () => {
    mockApiRoutes({
      recent: makeRecent([
        makeJob({ id: 'j-1', company: 'Acme Corp', position: 'Backend Engineer' }),
      ]),
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Acme Corp')).toBeInTheDocument());
    expect(
      screen.queryByText('Applied, then moved to interviewing.'),
    ).not.toBeInTheDocument();
  });

  it('shows a failure message for recent activity when that call fails, independent of stats', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.startsWith('/jobs?')) return Promise.reject(new Error('network error'));
      if (url.startsWith('/jobs/stats/funnel')) return Promise.resolve({ data: makeFunnel() });
      if (url.startsWith('/jobs/stats/trend')) return Promise.resolve({ data: makeTrend() });
      if (url.startsWith('/jobs/stats')) return Promise.resolve({ data: makeStats() });
      if (url.startsWith('/jobs/attention')) return Promise.resolve({ data: [] });
      return Promise.reject(new Error(`unhandled url: ${url}`));
    });
    renderPage();

    await waitFor(() => expect(screen.getByText('Failed to load recent jobs.')).toBeInTheDocument());
    // stats query is independent — it still resolves fine despite the jobs failure.
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
  });

  it('refetches stats/funnel/trend with the newly selected range', async () => {
    mockApiRoutes();
    renderPage();

    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats?range=90d'),
    );

    fireEvent.click(screen.getByRole('button', { name: '30d' }));

    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats?range=30d'),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats/funnel?range=30d');
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats/trend?range=30d');
  });
});
