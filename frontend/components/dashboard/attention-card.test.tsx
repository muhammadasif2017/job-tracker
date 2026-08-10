import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AttentionCard } from './attention-card';
import type { AttentionItem, Job } from '../../types';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
}));

vi.mock('../../lib/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/utils')>(
      '../../lib/utils',
    );
  return { ...actual, formatRelative: () => '2 days ago' };
});

import api from '../../lib/api';

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

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AttentionCard />
    </QueryClientProvider>,
  );
}

describe('AttentionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeletons while loading', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
  });

  it('shows the all-caught-up message when there are no items', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    renderCard();
    await waitFor(() => {
      expect(
        screen.getByText('All caught up — nothing needs action right now.'),
      ).toBeInTheDocument();
    });
  });

  it('renders a job link with company, position, and message for each attention type', async () => {
    const items: AttentionItem[] = [
      {
        type: 'UPCOMING_INTERVIEW',
        since: '2026-01-10T00:00:00Z',
        job: makeJob({ id: 'j-1', company: 'Acme Corp', position: 'Backend Engineer' }),
      },
      {
        type: 'STALE_INTERVIEWING',
        since: '2026-01-05T00:00:00Z',
        job: makeJob({ id: 'j-2', company: 'Globex', position: 'Frontend Engineer' }),
      },
      {
        type: 'STALE_APPLIED',
        since: '2026-01-01T00:00:00Z',
        job: makeJob({ id: 'j-3', company: 'Initech', position: 'Fullstack Engineer' }),
      },
    ];
    vi.mocked(api.get).mockResolvedValue({ data: items });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('link', { name: /acme corp.*backend engineer/i }),
    ).toHaveAttribute('href', '/jobs/j-1');
    expect(
      screen.getByText('Interview 2 days ago — prepare'),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: /globex.*frontend engineer/i }),
    ).toHaveAttribute('href', '/jobs/j-2');
    expect(
      screen.getByText('No activity since 2 days ago — nudge the recruiter'),
    ).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: /initech.*fullstack engineer/i }),
    ).toHaveAttribute('href', '/jobs/j-3');
    expect(
      screen.getByText('Applied 2 days ago — follow up or mark ghosted'),
    ).toBeInTheDocument();
  });

  it('does not show the empty-state message when items are present', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        {
          type: 'STALE_APPLIED',
          since: '2026-01-01T00:00:00Z',
          job: makeJob(),
        },
      ],
    });
    renderCard();
    await waitFor(() => {
      expect(screen.getByText('Acme Corp', { exact: false })).toBeInTheDocument();
    });
    expect(
      screen.queryByText('All caught up — nothing needs action right now.'),
    ).not.toBeInTheDocument();
  });
});
