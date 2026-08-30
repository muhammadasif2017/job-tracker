import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useJobEventsQuery } from './hooks';
import type { JobEvent } from '../../types';

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import api from '../../lib/api';

const events: JobEvent[] = [
  {
    id: 'e-1',
    jobId: 'j-1',
    type: 'CREATED',
    toStatus: 'APPLIED',
    createdAt: '2026-01-01T00:00:00Z',
  },
];

function makeWrapper(retry: number | false = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useJobEventsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call the API when id is empty', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useJobEventsQuery(''), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('unwraps the paginated { data, meta } response into a flat array', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: events, meta: { total: 1, page: 1, limit: 50, totalPages: 1 } },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useJobEventsQuery('j-1'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(events));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/j-1/events');
  });

  it('surfaces an API failure as an error instead of swallowing it', async () => {
    vi.mocked(api.get).mockRejectedValue({
      isAxiosError: true,
      response: { status: 500 },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useJobEventsQuery('j-1'), { wrapper });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});
