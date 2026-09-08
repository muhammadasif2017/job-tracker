import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QueueHealthPanel } from './queue-health-panel';
import type { QueueObservability, QueueSnapshot } from '../../types';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import api from '../../lib/api';

function queue(
  name: string,
  counts: Partial<NonNullable<QueueSnapshot['counts']>> | null = {},
): QueueSnapshot {
  if (counts === null) return { name, available: false, counts: null };
  return {
    name,
    available: true,
    counts: {
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      ...counts,
    },
  };
}

function observability(
  overrides: Partial<QueueObservability> = {},
): QueueObservability {
  return {
    queues: [
      queue('company-target-enrichment', { waiting: 2, active: 1 }),
      queue('job-timeline-summary'),
      queue('notifications', { completed: 40 }),
    ],
    companyStatuses: [
      { status: 'PENDING', label: 'Queued', count: 3 },
      { status: 'PROCESSING', label: 'Processing', count: 0 },
      { status: 'COMPLETED', label: 'Completed', count: 12 },
      { status: 'FAILED', label: 'Failed', count: 1 },
      { status: null, label: 'Never triggered', count: 27 },
    ],
    strandedPending: 0,
    ...overrides,
  };
}

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <QueueHealthPanel />
    </QueryClientProvider>,
  );
}

describe('QueueHealthPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading placeholder while the query is pending', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <QueueHealthPanel />
      </QueryClientProvider>,
    );
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(
      0,
    );
  });

  it('fetches the observability endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: observability() });
    renderPanel();
    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith('/admin/queues'),
    );
  });

  it('renders each queue with its counts', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: observability() });
    renderPanel();

    expect(await screen.findByText('Company enrichment')).toBeInTheDocument();
    expect(screen.getByText('Timeline summary')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('labels the null company-status bucket "Never triggered" and never as a failure', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: observability() });
    renderPanel();

    const label = await screen.findByText('Never triggered');
    expect(label).toBeInTheDocument();
    expect(label.nextElementSibling).toHaveTextContent('27');
    expect(screen.queryByText('No progress')).not.toBeInTheDocument();
  });

  it('does not raise an alert when nothing is stranded', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: observability() });
    renderPanel();

    await screen.findByText('Company enrichment');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('raises a prominent alert when companies are stranded', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: observability({ strandedPending: 4 }),
    });
    renderPanel();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('4');
    expect(alert).toHaveTextContent(/stranded companies/i);
    expect(alert).toHaveTextContent(/PENDING/);
  });

  it('uses the singular form for a single stranded company', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: observability({ strandedPending: 1 }),
    });
    renderPanel();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /stranded company —/i,
    );
  });

  it('marks an unreachable queue instead of showing zeroes that look healthy', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: observability({
        queues: [
          queue('company-target-enrichment', null),
          queue('job-timeline-summary'),
          queue('notifications'),
        ],
        strandedPending: null,
      }),
    });
    renderPanel();

    expect(await screen.findByText(/Queue unreachable/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Stranded-company detection is unavailable/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('still shows the database status counts when a queue is unreachable', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: observability({
        queues: [queue('company-target-enrichment', null)],
        strandedPending: null,
      }),
    });
    renderPanel();

    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('shows a retry affordance when the request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('network down'));
    renderPanel();

    expect(
      await screen.findByText('Failed to load queue health'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('refetches on demand rather than polling', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: observability() });
    renderPanel();
    await screen.findByText('Company enrichment');
    expect(vi.mocked(api.get)).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(vi.mocked(api.get)).toHaveBeenCalledTimes(2));
  });
});
