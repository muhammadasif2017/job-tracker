import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompaniesPage from './page';
import type { Company, PaginatedCompanies } from '../../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
  getErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

// The dialogs and the duplicate banner run their own queries; stubbing them
// keeps `lastGetUrl` reading the companies list request and nothing else.
vi.mock('../../../components/companies/company-form', () => ({
  CompanyForm: () => null,
}));

vi.mock('../../../components/companies/csv-import-dialog', () => ({
  CsvImportDialog: () => null,
}));

vi.mock('../../../components/companies/merge-company-dialog', () => ({
  MergeCompanyDialog: () => null,
}));

vi.mock('../../../components/companies/duplicate-suggestions-banner', () => ({
  DuplicateSuggestionsBanner: () => null,
}));

vi.mock('../../../components/companies/company-list', () => ({
  CompanyList: ({ companies }: { companies: Company[] }) => (
    <div data-testid="company-list">
      {companies.map((c) => (
        <span key={c.id}>{c.name}</span>
      ))}
    </div>
  ),
}));

import api from '../../../lib/api';

const companies: Company[] = [
  {
    id: 'c-1',
    name: 'Systems Limited',
    city: 'LAHORE',
    priority: 'HIGH',
    status: null,
    techStack: [],
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

function page(overrides: Partial<PaginatedCompanies> = {}): PaginatedCompanies {
  return {
    data: companies,
    meta: { total: 1, page: 1, limit: 10, totalPages: 1 },
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CompaniesPage />
    </QueryClientProvider>,
  );
}

function lastGetUrl() {
  const calls = vi.mocked(api.get).mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe('CompaniesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: page() });
  });

  it('lists the companies returned by the query', async () => {
    renderPage();
    expect(await screen.findByText('Systems Limited')).toBeInTheDocument();
    expect(lastGetUrl()).not.toContain('priority=');
  });

  it('sends the selected priority as a filter', async () => {
    renderPage();
    await screen.findByText('Systems Limited');

    fireEvent.change(screen.getByLabelText('Filter by priority'), {
      target: { value: 'HIGH' },
    });

    await waitFor(() => expect(lastGetUrl()).toContain('priority=HIGH'));
  });

  it('resets to the first page when the priority filter changes', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: page({ meta: { total: 30, page: 1, limit: 10, totalPages: 3 } }),
    });
    renderPage();
    await screen.findByText('Systems Limited');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastGetUrl()).toContain('page=2'));

    fireEvent.change(screen.getByLabelText('Filter by priority'), {
      target: { value: 'LOW' },
    });

    await waitFor(() => {
      const url = lastGetUrl();
      expect(url).toContain('page=1');
      expect(url).toContain('priority=LOW');
    });
  });
});
