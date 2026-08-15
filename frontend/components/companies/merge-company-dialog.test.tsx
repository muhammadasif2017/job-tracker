import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MergeCompanyDialog } from './merge-company-dialog';
import type { Company } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getErrorMessage: (err: unknown, fallback: string) => {
    const axiosErr = err as {
      isAxiosError?: boolean;
      response?: { data?: { message?: unknown } };
    };
    if (!axiosErr?.isAxiosError) return fallback;
    const message = axiosErr.response?.data?.message;
    if (Array.isArray(message)) return message.join('. ');
    return typeof message === 'string' ? message : fallback;
  },
}));

import api from '../../lib/api';

const canonical: Company = {
  id: 'canonical-1',
  name: 'Systems Limited',
  city: 'LAHORE',
  priority: 'HIGH',
  status: 'COMPLETED',
  techStack: [],
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

const duplicate: Company = {
  id: 'duplicate-1',
  name: 'Systems Ltd',
  city: 'LAHORE',
  priority: 'MEDIUM',
  status: null,
  techStack: [],
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MergeCompanyDialog open onClose={onClose} company={canonical} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('MergeCompanyDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing before search is typed', () => {
    renderDialog();
    expect(
      screen.getByText(/type a company name to search/i),
    ).toBeInTheDocument();
  });

  it('searches and excludes the canonical company from results', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [duplicate, canonical], meta: {} },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/search for a duplicate company/i), {
      target: { value: 'systems' },
    });

    await waitFor(() => {
      expect(screen.getByText('Systems Ltd')).toBeInTheDocument();
    });
    expect(screen.queryByText('Systems Limited')).not.toBeInTheDocument();
  });

  it('shows a confirm step naming both companies before merging', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [duplicate], meta: {} },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/search for a duplicate company/i), {
      target: { value: 'ltd' },
    });
    await waitFor(() => screen.getByText('Systems Ltd'));
    fireEvent.click(screen.getByText('Systems Ltd'));

    expect(
      screen.getByRole('button', { name: /merge companies/i }),
    ).toBeInTheDocument();
    // Both names appear in the confirm paragraph, split across <strong>
    // tags — check the rendered text directly rather than getByText, which
    // matches ambiguously across the paragraph and its nested elements.
    expect(document.body.textContent).toContain('Systems Ltd');
    expect(document.body.textContent).toContain('Systems Limited');
  });

  it('calls the merge endpoint with canonical and duplicate ids on confirm', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [duplicate], meta: {} },
    });
    vi.mocked(api.post).mockResolvedValue({ data: canonical });
    const { onClose } = renderDialog();

    fireEvent.change(screen.getByLabelText(/search for a duplicate company/i), {
      target: { value: 'ltd' },
    });
    await waitFor(() => screen.getByText('Systems Ltd'));
    fireEvent.click(screen.getByText('Systems Ltd'));
    fireEvent.click(screen.getByRole('button', { name: /merge companies/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/companies/canonical-1/merge', {
        duplicateCompanyId: 'duplicate-1',
      });
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows a conflict picker when an enrichment field differs, defaulting to the canonical value', async () => {
    const duplicateWithIndustry: Company = {
      ...duplicate,
      industry: 'Fintech',
    };
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [duplicateWithIndustry], meta: {} },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/search for a duplicate company/i), {
      target: { value: 'ltd' },
    });
    await waitFor(() => screen.getByText('Systems Ltd'));
    fireEvent.click(screen.getByText('Systems Ltd'));

    // Conflict step, not confirm — Industry differs (canonical has none set).
    expect(screen.getByText('Industry')).toBeInTheDocument();
    expect(screen.getByText('(empty)')).toBeInTheDocument();
    expect(screen.getByText('Fintech')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /merge companies/i }),
    ).not.toBeInTheDocument();

    // Default pick is canonical's (empty) value.
    const canonicalRadio = screen.getByRole('radio', {
      name: /systems limited: \(empty\)/i,
    });
    expect(canonicalRadio).toBeChecked();
  });

  it('sends the picked duplicate value as a fieldOverride on merge', async () => {
    const duplicateWithIndustry: Company = {
      ...duplicate,
      industry: 'Fintech',
    };
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [duplicateWithIndustry], meta: {} },
    });
    vi.mocked(api.post).mockResolvedValue({ data: canonical });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/search for a duplicate company/i), {
      target: { value: 'ltd' },
    });
    await waitFor(() => screen.getByText('Systems Ltd'));
    fireEvent.click(screen.getByText('Systems Ltd'));

    fireEvent.click(
      screen.getByRole('radio', { name: /systems ltd: fintech/i }),
    );
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    fireEvent.click(screen.getByRole('button', { name: /merge companies/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/companies/canonical-1/merge', {
        duplicateCompanyId: 'duplicate-1',
        fieldOverrides: { industry: 'Fintech' },
      });
    });
  });

  it('skips the conflict picker entirely when no enrichment fields differ', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { data: [duplicate], meta: {} },
    });
    renderDialog();

    fireEvent.change(screen.getByLabelText(/search for a duplicate company/i), {
      target: { value: 'ltd' },
    });
    await waitFor(() => screen.getByText('Systems Ltd'));
    fireEvent.click(screen.getByText('Systems Ltd'));

    expect(
      screen.getByRole('button', { name: /merge companies/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Industry')).not.toBeInTheDocument();
  });

  it('skips the search step and jumps to conflicts when preSeedDuplicate is provided', () => {
    const duplicateWithIndustry: Company = {
      ...duplicate,
      industry: 'Fintech',
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MergeCompanyDialog
          open
          onClose={vi.fn()}
          company={canonical}
          preSeedDuplicate={duplicateWithIndustry}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.queryByLabelText(/search for a duplicate company/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Industry')).toBeInTheDocument();
    expect(screen.getByText('Fintech')).toBeInTheDocument();
  });
});
