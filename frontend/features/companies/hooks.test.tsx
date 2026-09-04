import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useDuplicateSuggestionsQuery,
  useUpdateCompanyMutation,
  type CompanyWritePayload,
} from './hooks';
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

describe('useUpdateCompanyMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  const writePayload: CompanyWritePayload = {
    name: 'Renamed Co',
    city: 'LAHORE',
    location: null,
    priority: 'HIGH',
    personalNotes: null,
    websiteUrl: null,
    linkedinUrl: null,
    businessMode: null,
    productDescription: null,
    industry: null,
    companySize: null,
    techStack: [],
    cultureSummary: null,
    workPolicy: null,
    headquarters: null,
    address: null,
  };

  it('invalidates the company cache instead of overwriting it with the bare PATCH response', async () => {
    const { qc, wrapper } = makeWrapper();
    // PATCH /companies/:id returns a bare Company row — no contacts/jobs
    // includes, unlike GET /companies/:id — so the pre-existing cache
    // (seeded here as if a prior GET had populated it) carries relations
    // the PATCH response does not.
    const withRelations = {
      ...companyA,
      jobs: [{ id: 'job-1' }],
      contacts: [{ id: 'contact-1' }],
    };
    qc.setQueryData(['company', 'a'], withRelations);

    vi.mocked(api.patch).mockResolvedValue({
      data: { ...companyA, name: 'Renamed Co' },
    });
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateCompanyMutation('a'), {
      wrapper,
    });
    result.current.mutate(writePayload);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['company', 'a'] });
    // The cache must not have been clobbered with the relation-less PATCH
    // response — invalidation (not setQueryData) is what should have run.
    expect(qc.getQueryData(['company', 'a'])).toEqual(withRelations);
  });
});
