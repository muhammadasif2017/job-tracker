import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDuplicateSuggestionsQuery } from './hooks';
import type { Company, DuplicateSuggestion } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

import api from '../../lib/api';

const companyA: Company = {
  id: 'a',
  name: 'Systems Limited',
  city: 'LAHORE',
  priority: 'HIGH',
  status: 'COMPLETED',
  techStack: [],
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

const companyB: Company = { ...companyA, id: 'b', name: 'Systems Ltd' };

const suggestion: DuplicateSuggestion = {
  companyA,
  companyB,
  reason: 'name',
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useDuplicateSuggestionsQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches from /companies/duplicates under the ["companies", "duplicates"] key', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [suggestion] });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useDuplicateSuggestionsQuery(), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).toEqual([suggestion]));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/companies/duplicates');
    expect(qc.getQueryData(['companies', 'duplicates'])).toEqual([suggestion]);
  });
});
