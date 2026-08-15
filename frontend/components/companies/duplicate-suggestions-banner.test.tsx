import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DuplicateSuggestionsBanner } from './duplicate-suggestions-banner';
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

function renderBanner(onReview = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DuplicateSuggestionsBanner onReview={onReview} />
    </QueryClientProvider>,
  );
  return { onReview };
}

describe('DuplicateSuggestionsBanner', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders nothing when there are no suggestions', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    const { container } = render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <DuplicateSuggestionsBanner onReview={vi.fn()} />
      </QueryClientProvider>,
    );
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the pair with its reason and calls onReview with companyA, companyB', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [suggestion] });
    const { onReview } = renderBanner();

    expect(
      await screen.findByText(/systems limited/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/similar name/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /review/i }));
    expect(onReview).toHaveBeenCalledWith(companyA, companyB);
  });

  it('removes a pair from view when dismissed, without calling onReview', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [suggestion] });
    const { onReview } = renderBanner();

    await screen.findByText(/systems limited/i);
    fireEvent.click(
      screen.getByRole('button', { name: /dismiss suggestion/i }),
    );

    expect(screen.queryByText(/systems limited/i)).not.toBeInTheDocument();
    expect(onReview).not.toHaveBeenCalled();
  });
});
