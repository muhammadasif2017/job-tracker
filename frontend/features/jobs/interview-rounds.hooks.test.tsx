import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useCreateInterviewRoundMutation,
  useRemoveInterviewRoundMutation,
} from './interview-rounds.hooks';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import api from '../../lib/api';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
}

const invalidatedKeys = (spy: ReturnType<typeof setup>['invalidate']) =>
  spy.mock.calls.map(([filters]) => filters?.queryKey);

// A round write is job activity and moves nextInterviewAt, so it can add or
// remove a job from the "Looks ghosted" rule — the dashboard card and the
// list/kanban badges read ['ghost-suggestions'] and must refetch.
describe('interview round mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates ghost suggestions and the job caches after creating a round', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { id: 'r-1' } });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(
      () => useCreateInterviewRoundMutation('j-1'),
      { wrapper },
    );

    result.current.mutate({
      stage: 'Tech',
      scheduledAt: '2026-10-01T10:00:00+05:00',
      durationMinutes: 60,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys(invalidate)).toEqual(
      expect.arrayContaining([
        ['ghost-suggestions'],
        ['jobs'],
        ['stats'],
        ['attention'],
        ['job', 'j-1'],
        ['job-events', 'j-1'],
      ]),
    );
  });

  it('invalidates ghost suggestions after removing a round', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(
      () => useRemoveInterviewRoundMutation('j-1'),
      { wrapper },
    );

    result.current.mutate('r-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedKeys(invalidate)).toContainEqual(['ghost-suggestions']);
  });
});
