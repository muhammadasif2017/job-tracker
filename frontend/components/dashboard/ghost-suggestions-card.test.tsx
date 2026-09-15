import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GhostSuggestionsCard } from './ghost-suggestions-card';
import type { GhostSuggestion, Job } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

vi.mock('../../lib/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../../lib/utils')>('../../lib/utils');
  return { ...actual, formatRelative: () => '3 weeks ago' };
});

import { toast } from 'sonner';
import api from '../../lib/api';

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'j-1',
    company: 'Acme Corp',
    position: 'Backend Engineer',
    status: 'APPLIED',
    jobType: 'ONSITE',
    appliedAt: '2026-08-01T00:00:00Z',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    userId: 'u-1',
    ...overrides,
  };
}

const SUGGESTIONS: GhostSuggestion[] = [
  { since: '2026-08-01T00:00:00Z', job: makeJob() },
  {
    since: '2026-08-10T00:00:00Z',
    job: makeJob({
      id: 'j-2',
      company: 'Globex',
      position: 'Frontend Engineer',
      status: 'INTERVIEWING',
    }),
  },
];

function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GhostSuggestionsCard />
    </QueryClientProvider>,
  );
}

describe('GhostSuggestionsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows skeletons while loading', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    const { container } = renderCard();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
  });

  it('shows an empty message when nothing looks ghosted', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    renderCard();
    await waitFor(() => {
      expect(
        screen.getByText(
          'Nothing looks ghosted — every application had recent activity.',
        ),
      ).toBeInTheDocument();
    });
  });

  it('lists each silent application with a link and how long it has been quiet', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: SUGGESTIONS });
    renderCard();

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /acme corp.*backend engineer/i }),
    ).toHaveAttribute('href', '/jobs/j-1');
    expect(
      screen.getByRole('link', { name: /globex.*frontend engineer/i }),
    ).toHaveAttribute('href', '/jobs/j-2');
    expect(screen.getAllByText('No activity since 3 weeks ago')).toHaveLength(
      2,
    );
    expect(
      screen.queryByText(
        'Nothing looks ghosted — every application had recent activity.',
      ),
    ).not.toBeInTheDocument();
  });

  it('marks a single job ghosted', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: SUGGESTIONS });
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'j-2' } });
    renderCard();

    fireEvent.click(
      await screen.findByRole('button', { name: 'Mark Globex as ghosted' }),
    );

    await waitFor(() =>
      expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/jobs/j-2', {
        status: 'GHOSTED',
      }),
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('dismisses a single suggestion', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: SUGGESTIONS });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    renderCard();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Dismiss suggestion for Acme Corp',
      }),
    );

    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/jobs/j-1/ghost-suggestion/dismiss',
      ),
    );
    expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
  });

  describe('Mark all ghosted', () => {
    it('is hidden when nothing looks ghosted', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: [] });
      renderCard();
      await screen.findByText(
        'Nothing looks ghosted — every application had recent activity.',
      );
      expect(
        screen.queryByRole('button', { name: /mark all ghosted/i }),
      ).not.toBeInTheDocument();
    });

    it('asks for confirmation and sends nothing on cancel', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: SUGGESTIONS });
      renderCard();

      fireEvent.click(
        await screen.findByRole('button', { name: 'Mark all ghosted (2)' }),
      );
      expect(
        await screen.findByText('Mark 2 jobs as ghosted?'),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(
          screen.queryByText('Mark 2 jobs as ghosted?'),
        ).not.toBeInTheDocument(),
      );
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('sends the listed ids on confirm and reports the server count', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: SUGGESTIONS });
      // One job got activity after the card loaded, so the server skips it.
      vi.mocked(api.post).mockResolvedValue({ data: { updated: 1 } });
      renderCard();

      fireEvent.click(
        await screen.findByRole('button', { name: 'Mark all ghosted (2)' }),
      );
      fireEvent.click(
        await screen.findByRole('button', { name: 'Mark 2 ghosted' }),
      );

      await waitFor(() =>
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/jobs/ghost-suggestions/mark-ghosted',
          { jobIds: ['j-1', 'j-2'] },
        ),
      );
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
          'Marked 1 job as ghosted',
        ),
      );
      await waitFor(() =>
        expect(
          screen.queryByText('Mark 2 jobs as ghosted?'),
        ).not.toBeInTheDocument(),
      );
    });
  });
});
