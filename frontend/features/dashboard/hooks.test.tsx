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
} from './hooks';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn() },
}));

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
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats/funnel?range=90d');
    expect(qc.getQueryData(['analytics', 'funnel', '90d'])).toEqual({ stages: [] });
  });
});

describe('useTrendQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches trend stats under ["analytics", "trend", range]', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { points: [] } });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useTrendQuery('7d'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual({ points: [] }));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/stats/trend?range=7d');
    expect(qc.getQueryData(['analytics', 'trend', '7d'])).toEqual({ points: [] });
  });
});

describe('useRecentJobsQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches the 5 most recent jobs under the shared jobs list key', async () => {
    const data = { data: [], meta: { total: 0, page: 1, limit: 5, totalPages: 0 } };
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
