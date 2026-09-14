import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GhostBadge } from './ghost-badge';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import api from '../../lib/api';

function renderBadge(jobId = 'j-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GhostBadge jobId={jobId} company="Acme Corp" />
    </QueryClientProvider>,
  );
}

describe('GhostBadge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing for a job that is not a ghost suggestion', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ since: '2026-08-01T00:00:00Z', job: { id: 'other' } }],
    });
    renderBadge('j-1');

    await waitFor(() =>
      expect(vi.mocked(api.get)).toHaveBeenCalledWith(
        '/jobs/ghost-suggestions',
      ),
    );
    expect(screen.queryByText('No reply 14d+')).not.toBeInTheDocument();
  });

  it('shows the badge with both actions for a suggested job', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ since: '2026-08-01T00:00:00Z', job: { id: 'j-1' } }],
    });
    renderBadge('j-1');

    expect(await screen.findByText('No reply 14d+')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Mark Acme Corp as ghosted' }),
    );
    await waitFor(() =>
      expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/jobs/j-1', {
        status: 'GHOSTED',
      }),
    );
  });

  it('dismisses the suggestion', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{ since: '2026-08-01T00:00:00Z', job: { id: 'j-1' } }],
    });
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    renderBadge('j-1');

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
  });
});
