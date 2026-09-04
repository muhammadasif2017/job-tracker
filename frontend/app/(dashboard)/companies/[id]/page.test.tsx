import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CompanyDetailPage from './page';
import type { Company } from '../../../../types';

const replace = vi.fn();

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'c-1' }),
  useRouter: () => ({ replace }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../lib/api', () => ({
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

vi.mock('../../../../components/companies/company-form', () => ({
  CompanyForm: ({ open, company }: { open: boolean; company?: Company }) =>
    open ? <div data-testid="company-form" data-company-id={company?.id ?? ''} /> : null,
}));

vi.mock('../../../../components/companies/company-jobs', () => ({
  CompanyJobs: ({ jobs }: { jobs: unknown[] }) => (
    <div data-testid="company-jobs" data-count={jobs.length} />
  ),
}));

vi.mock('../../../../components/companies/company-contacts', () => ({
  CompanyContacts: ({ companyId, contacts }: { companyId: string; contacts: unknown[] }) => (
    <div data-testid="company-contacts" data-company-id={companyId} data-count={contacts.length} />
  ),
}));

// This is the fix under test: the company-detail page renders the same
// CompanyProfileCard the job-detail page uses (enrichment status, FAILED
// banner, unverified badges, Refresh button) instead of hand-rolling its
// own inline field list — so we assert it receives the full `company`
// object plus a company-scoped invalidateKey, not a stripped-down prop set.
vi.mock('../../../../components/company-profile-card', () => ({
  CompanyProfileCard: ({
    profile,
    invalidateKey,
  }: {
    profile?: { status: string | null };
    invalidateKey: unknown[];
  }) => (
    <div
      data-testid="company-profile-card"
      data-status={profile?.status ?? ''}
      data-invalidate-key={JSON.stringify(invalidateKey)}
    />
  ),
}));

import api from '../../../../lib/api';

function makeCompany(overrides: Partial<Company> = {}): Company {
  return {
    id: 'c-1',
    name: 'Acme',
    city: 'LAHORE',
    location: null,
    priority: 'HIGH',
    personalNotes: null,
    websiteUrl: null,
    linkedinUrl: null,
    businessMode: null,
    productDescription: null,
    status: null,
    industry: null,
    companySize: null,
    techStack: [],
    cultureSummary: null,
    workPolicy: null,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    contacts: [],
    jobs: [],
    ...overrides,
  };
}

function mockCompany(company: Company | undefined) {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url === '/companies/c-1') {
      return company
        ? Promise.resolve({ data: company })
        : Promise.reject({ isAxiosError: true, response: { status: 404 } });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CompanyDetailPage />
    </QueryClientProvider>,
  );
  return { qc };
}

describe('CompanyDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows skeletons while the company query is pending', () => {
      vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
      const { container } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <CompanyDetailPage />
        </QueryClientProvider>,
      );
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
  });

  describe('not found', () => {
    it('shows "Company not found." on a 404', async () => {
      mockCompany(undefined);
      renderPage();
      expect(await screen.findByText('Company not found.')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows "Failed to load company." on a non-404 failure', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('network down'));
      renderPage();
      expect(await screen.findByText('Failed to load company.')).toBeInTheDocument();
    });
  });

  describe('enrichment rendering — same CompanyProfileCard the job-detail page uses', () => {
    it('renders CompanyProfileCard with the full company as profile and a company-scoped invalidateKey', async () => {
      mockCompany(makeCompany({ status: 'COMPLETED' }));
      renderPage();
      await screen.findByText('Acme');
      const card = screen.getByTestId('company-profile-card');
      expect(card).toHaveAttribute('data-status', 'COMPLETED');
      expect(card).toHaveAttribute('data-invalidate-key', JSON.stringify(['company', 'c-1']));
    });

    it('passes PENDING/PROCESSING/FAILED status through unchanged for CompanyProfileCard to render its own state', async () => {
      mockCompany(makeCompany({ status: 'FAILED', errorMessage: 'boom' }));
      renderPage();
      await screen.findByText('Acme');
      expect(screen.getByTestId('company-profile-card')).toHaveAttribute(
        'data-status',
        'FAILED',
      );
    });
  });

  describe('detail rendering', () => {
    it('renders name, badges, and identity fields', async () => {
      mockCompany(
        makeCompany({
          websiteUrl: 'https://acme.example',
          linkedinUrl: 'https://linkedin.com/company/acme',
          location: 'Remote',
        }),
      );
      renderPage();
      expect(await screen.findByText('Acme')).toBeInTheDocument();
      expect(screen.getByText('Remote')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /visit/i })).toHaveAttribute(
        'href',
        'https://acme.example',
      );
      expect(screen.getByRole('link', { name: /open/i })).toHaveAttribute(
        'href',
        'https://linkedin.com/company/acme',
      );
    });

    it('passes ids/counts down to child sections', async () => {
      mockCompany(
        makeCompany({
          jobs: [
            {
              id: 'j-1',
              position: 'Engineer',
              status: 'APPLIED',
              priority: 'HIGH',
              appliedAt: '2026-06-01T00:00:00Z',
            },
          ],
          contacts: [
            {
              id: 'ct-1',
              companyId: 'c-1',
              name: 'Jane',
              createdAt: '2026-06-01T00:00:00Z',
              updatedAt: '2026-06-01T00:00:00Z',
            },
          ],
        }),
      );
      renderPage();
      await screen.findByText('Acme');
      expect(screen.getByTestId('company-jobs')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('company-contacts')).toHaveAttribute('data-count', '1');
      expect(screen.getByTestId('company-contacts')).toHaveAttribute('data-company-id', 'c-1');
    });
  });

  describe('delete flow', () => {
    it('deletes and redirects to /companies on success', async () => {
      mockCompany(makeCompany());
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /delete/i }));
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/companies/c-1'),
      );
      expect(replace).toHaveBeenCalledWith('/companies');
    });
  });

  describe('edit', () => {
    it('opens CompanyForm pre-filled with the current company on Edit', async () => {
      mockCompany(makeCompany());
      renderPage();
      await screen.findByText('Acme');
      fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
      expect(screen.getByTestId('company-form')).toHaveAttribute('data-company-id', 'c-1');
    });
  });
});
