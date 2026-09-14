import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useStatsQuery,
  useFunnelQuery,
  useTrendQuery,
  useRecentJobsQuery,
  useAttentionQuery,
  useGhostSuggestionsQuery,
  useGhostSuggestedIds,
  useMarkJobGhostedMutation,
  useDismissGhostSuggestionMutation,
  useMarkAllGhostedMutation,
} from './hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import { toast } from 'sonner';
import api from '../../lib/api';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useStatsQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches stats for the given range under the ["stats", range] key', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { total: 5 } });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useStatsQuery('30d'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ total: 5 }));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats?range=30d');
    expect(qc.getQueryData(['stats', '30d'])).toEqual({ total: 5 });
  });
});

describe('useFunnelQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches funnel stats under ["analytics", "funnel", range]', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { stages: [] } });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useFunnelQuery('90d'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ stages: [] }));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/jobs/stats/funnel?range=90d',
    );
    expect(qc.getQueryData(['analytics', 'funnel', '90d'])).toEqual({
      stages: [],
    });
  });
});

describe('useTrendQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches trend stats under ["analytics", "trend", range]', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { points: [] } });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useTrendQuery('all'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ points: [] }));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/jobs/stats/trend?range=all',
    );
    expect(qc.getQueryData(['analytics', 'trend', 'all'])).toEqual({
      points: [],
    });
  });
});

describe('useRecentJobsQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the 5 most recent jobs under the shared jobs list key', async () => {
    const data = {
      data: [],
      meta: { total: 0, page: 1, limit: 5, totalPages: 0 },
    };
    vi.mocked(api.get).mockResolvedValue({ data });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useRecentJobsQuery(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(data));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith(
      '/jobs?limit=5&sortBy=createdAt&sortOrder=desc',
    );
    expect(
      qc.getQueryData(['jobs', { limit: 5, sortBy: 'createdAt' }]),
    ).toEqual(data);
  });
});

describe('useAttentionQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches attention items under the ["attention"] key', async () => {
    const items = [{ id: 'j-1', reason: 'stale' }];
    vi.mocked(api.get).mockResolvedValue({ data: items });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useAttentionQuery(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(items));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/attention');
    expect(qc.getQueryData(['attention'])).toEqual(items);
  });
});

describe('useGhostSuggestionsQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches ghost suggestions under the ["ghost-suggestions"] key', async () => {
    const items = [{ since: '2026-08-01T00:00:00Z', job: { id: 'j-1' } }];
    vi.mocked(api.get).mockResolvedValue({ data: items });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useGhostSuggestionsQuery(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual(items));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/ghost-suggestions');
    expect(qc.getQueryData(['ghost-suggestions'])).toEqual(items);
  });
});

describe('useGhostSuggestedIds', () => {
  beforeEach(() => vi.clearAllMocks());

  it('derives a Set of job ids from the shared ghost-suggestions query', async () => {
    const items = [
      { since: '2026-08-01T00:00:00Z', job: { id: 'j-1' } },
      { since: '2026-08-02T00:00:00Z', job: { id: 'j-2' } },
    ];
    vi.mocked(api.get).mockResolvedValue({ data: items });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useGhostSuggestedIds(), { wrapper });

    await waitFor(() =>
      expect(result.current.data).toEqual(new Set(['j-1', 'j-2'])),
    );
    // Same cache entry as the card, so badges add no extra request.
    expect(qc.getQueryData(['ghost-suggestions'])).toEqual(items);
  });
});

// Every ghost action changes which jobs are suggested and what the dashboard
// counts, so each one has to refresh the card, the badges (driven by the same
// query), Needs Attention, the job lists, and the stats.
const JOB_LIST_KEYS = [
  ['ghost-suggestions'],
  ['attention'],
  ['jobs'],
  ['stats'],
  ['analytics', 'funnel'],
];

// Spies on the client's invalidations; call the returned function after the
// mutation settles to read the query keys that were invalidated.
function invalidatedKeys(qc: QueryClient) {
  const spy = vi.spyOn(qc, 'invalidateQueries');
  return () =>
    spy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
}

describe('useMarkJobGhostedMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('PATCHes the job to GHOSTED and refreshes every affected cache', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { id: 'j-1' } });
    const { qc, wrapper } = makeWrapper();
    const keys = invalidatedKeys(qc);
    const { result } = renderHook(() => useMarkJobGhostedMutation(), {
      wrapper,
    });

    await result.current.mutateAsync('j-1');

    expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/jobs/j-1', {
      status: 'GHOSTED',
    });
    expect(keys()).toEqual(
      expect.arrayContaining([
        ...JOB_LIST_KEYS,
        ['job', 'j-1'],
        ['job-events', 'j-1'],
      ]),
    );
  });

  it('shows an error toast when the PATCH fails', async () => {
    vi.mocked(api.patch).mockRejectedValue(new Error('boom'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMarkJobGhostedMutation(), {
      wrapper,
    });

    await expect(result.current.mutateAsync('j-1')).rejects.toThrow('boom');
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Failed to mark as ghosted',
    );
  });
});

describe('useDismissGhostSuggestionMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POSTs the dismissal and refreshes the card and Needs Attention', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    const { qc, wrapper } = makeWrapper();
    const keys = invalidatedKeys(qc);
    const { result } = renderHook(() => useDismissGhostSuggestionMutation(), {
      wrapper,
    });

    await result.current.mutateAsync('j-1');

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/jobs/j-1/ghost-suggestion/dismiss',
    );
    expect(keys()).toEqual(
      expect.arrayContaining([['ghost-suggestions'], ['attention']]),
    );
  });

  it('shows an error toast when the dismissal fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('boom'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useDismissGhostSuggestionMutation(), {
      wrapper,
    });

    await expect(result.current.mutateAsync('j-1')).rejects.toThrow('boom');
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Failed to dismiss suggestion',
    );
  });
});

describe('useMarkAllGhostedMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the listed ids and reports the count the server actually moved', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { updated: 2 } });
    const { qc, wrapper } = makeWrapper();
    const keys = invalidatedKeys(qc);
    const { result } = renderHook(() => useMarkAllGhostedMutation(), {
      wrapper,
    });

    await result.current.mutateAsync(['a', 'b', 'c']);

    expect(vi.mocked(api.post)).toHaveBeenCalledWith(
      '/jobs/ghost-suggestions/mark-ghosted',
      { jobIds: ['a', 'b', 'c'] },
    );
    // 2, not 3: the server skips jobs that got activity since the card loaded.
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Marked 2 jobs as ghosted',
    );
    expect(keys()).toEqual(expect.arrayContaining(JOB_LIST_KEYS));
  });

  it('uses the singular for one job', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { updated: 1 } });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMarkAllGhostedMutation(), {
      wrapper,
    });

    await result.current.mutateAsync(['a']);

    expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
      'Marked 1 job as ghosted',
    );
  });

  it('shows an error toast when the bulk mark fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('boom'));
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useMarkAllGhostedMutation(), {
      wrapper,
    });

    await expect(result.current.mutateAsync(['a'])).rejects.toThrow('boom');
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Failed to mark jobs as ghosted',
    );
  });
});
