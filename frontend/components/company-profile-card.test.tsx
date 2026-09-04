import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanyProfileCard } from './company-profile-card';
import type { CompanyProfile } from '../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../lib/api', () => ({
  default: { post: vi.fn().mockResolvedValue({ data: {} }) },
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

import api from '../lib/api';

function makeProfile(overrides: Partial<CompanyProfile> = {}): CompanyProfile {
  return {
    id: 'cp-1',
    jobId: 'job-1',
    status: 'COMPLETED',
    techStack: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderCard(
  profile: CompanyProfile | null | undefined,
  jobId = 'job-1',
  companyId?: string | null,
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CompanyProfileCard
        profile={profile}
        companyId={companyId}
        invalidateKey={['job', jobId]}
      />
    </QueryClientProvider>,
  );
}

describe('CompanyProfileCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when profile is absent', () => {
    it('renders nothing when profile is null', () => {
      const { container } = renderCard(null);
      expect(container.firstChild).toBeNull();
    });

    it('renders nothing when profile is undefined', () => {
      const { container } = renderCard(undefined);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when status is PENDING', () => {
    it('shows "Queued…" label', () => {
      renderCard(makeProfile({ status: 'PENDING' }));
      expect(screen.getByText('Queued…')).toBeInTheDocument();
    });

    it('shows the Company Profile heading', () => {
      renderCard(makeProfile({ status: 'PENDING' }));
      expect(screen.getByText('Company Profile')).toBeInTheDocument();
    });

    it('does not show a Refresh button', () => {
      renderCard(makeProfile({ status: 'PENDING' }));
      expect(
        screen.queryByRole('button', { name: /refresh/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('when status is PROCESSING', () => {
    it('shows "Researching…" label', () => {
      renderCard(makeProfile({ status: 'PROCESSING' }));
      expect(screen.getByText('Researching…')).toBeInTheDocument();
    });

    it('does not show a Refresh button', () => {
      renderCard(makeProfile({ status: 'PROCESSING' }));
      expect(
        screen.queryByRole('button', { name: /refresh/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('when status is FAILED', () => {
    it('shows a generic friendly message, never the raw errorMessage, when it does not match a known failure kind', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage: 'Unexpected tool-call shape from LLM',
        }),
      );
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Unexpected tool-call shape/),
      ).not.toBeInTheDocument();
    });

    it('shows the same generic message for a vendor-specific error (e.g. an unknown/nonexistent model), never the raw text', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage:
            '404 {"error":{"message":"The model llama-3.3-99b-nonexistent does not exist or you do not have access to it.","code":"model_not_found"}}',
        }),
      );
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(
        screen.queryByText(/llama-3.3-99b-nonexistent/),
      ).not.toBeInTheDocument();
    });

    it('shows the same generic friendly message when errorMessage is absent', () => {
      renderCard(makeProfile({ status: 'FAILED' }));
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
    });

    it('shows the same generic message for a rate-limit error, never the raw text', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage:
            '429 {"error":{"message":"Rate limit reached for model..."}}',
        }),
      );
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(screen.queryByText(/429/)).not.toBeInTheDocument();
    });

    it('shows the same generic message for a timeout, never the raw text', () => {
      renderCard(
        makeProfile({ status: 'FAILED', errorMessage: 'API timeout' }),
      );
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(screen.queryByText('API timeout')).not.toBeInTheDocument();
    });

    it('shows the same generic message for a connection error', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage: 'connect ECONNREFUSED 127.0.0.1:443',
        }),
      );
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
    });

    it('shows the same generic message for an auth error, never the raw text', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage: '401 Invalid API Key provided',
        }),
      );
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Invalid API Key provided/),
      ).not.toBeInTheDocument();
    });

    it('shows a friendly no-data message when there is nothing to extract from', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage:
            'No extractable content: no website on file and web search returned nothing',
        }),
      );
      expect(
        screen.getByText(/couldn't find any public information/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Adding a company website/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/No extractable content/),
      ).not.toBeInTheDocument();
    });

    it('shows the same friendly no-data message for a raw tool_use_failed error from an empty-context run', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage:
            '400 {"error":{"message":"Tool choice is required, but model did not call a tool","type":"invalid_request_error","code":"tool_use_failed","failed_generation":"I\'m ready to extract the requested informa',
        }),
      );
      expect(
        screen.getByText(/couldn't find any public information/),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Tool choice is required/),
      ).not.toBeInTheDocument();
    });

    it('shows a Refresh button', () => {
      renderCard(makeProfile({ status: 'FAILED' }));
      expect(
        screen.getByRole('button', { name: /refresh/i }),
      ).toBeInTheDocument();
    });

    it('calls POST /companies/:companyId/enrichment when Refresh is clicked', async () => {
      renderCard(makeProfile({ status: 'FAILED' }), 'job-xyz', 'company-xyz');
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      await waitFor(() => {
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/companies/company-xyz/enrichment',
        );
      });
    });
  });

  describe('when re-running with last-known-good data (enrichedAt present)', () => {
    it('shows prior fields instead of a skeleton while PROCESSING', () => {
      renderCard(
        makeProfile({
          status: 'PROCESSING',
          industry: 'Fintech',
          enrichedAt: '2026-01-01T00:00:00Z',
        }),
      );
      expect(screen.getByText('Fintech')).toBeInTheDocument();
      expect(screen.getByText('Refreshing…')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /refresh/i }),
      ).not.toBeInTheDocument();
    });

    it('shows prior fields instead of a skeleton while PENDING', () => {
      renderCard(
        makeProfile({
          status: 'PENDING',
          industry: 'Fintech',
          enrichedAt: '2026-01-01T00:00:00Z',
        }),
      );
      expect(screen.getByText('Fintech')).toBeInTheDocument();
      expect(screen.getByText('Queued…')).toBeInTheDocument();
    });

    it('shows prior fields plus an inline failure banner (generic message, not raw) instead of the bare error card on FAILED', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          industry: 'Fintech',
          errorMessage: 'Unexpected tool-call shape from LLM',
          enrichedAt: '2026-01-01T00:00:00Z',
        }),
      );
      expect(screen.getByText('Fintech')).toBeInTheDocument();
      expect(screen.getByText(/Last refresh failed/)).toBeInTheDocument();
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(
        screen.queryByText(/Unexpected tool-call shape/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(/Showing your last successful result/),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /refresh/i }),
      ).toBeInTheDocument();
    });

    it('classifies the inline failure banner the same way as the no-data FAILED card, instead of always showing a raw message', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          industry: 'Fintech',
          errorMessage: 'API timeout',
          enrichedAt: '2026-01-01T00:00:00Z',
        }),
      );
      // Non-NO_DATA errors all collapse to the same generic message — the
      // friendly message should be shown, not the raw string, same as the
      // !hasData FAILED card
      expect(screen.getByText(/couldn't complete/)).toBeInTheDocument();
      expect(screen.queryByText(/API timeout/)).not.toBeInTheDocument();
    });

    it('still shows the loading skeleton when PROCESSING with no prior data', () => {
      renderCard(makeProfile({ status: 'PROCESSING' }));
      expect(screen.getByText('Researching…')).toBeInTheDocument();
      expect(screen.queryByText('Fintech')).not.toBeInTheDocument();
    });
  });

  describe('when fields are set but enrichment has never completed (user-edited/merged, no enrichedAt)', () => {
    // Regression test for ADR-029 §4: hasData used to check `enrichedAt`
    // alone, which is only ever set by a COMPLETED run. On the
    // company-detail page, fields can be set via CompanyForm or a merge's
    // fieldOverrides with enrichedAt still null — that case must not be
    // stuck behind the loading skeleton just because enrichment itself
    // never ran. This suite would pass unchanged against the pre-fix
    // `hasData = Boolean(profile.enrichedAt)` unless it drops enrichedAt
    // entirely, unlike every other "prior data" test above.
    it('shows fields instead of the loading skeleton while PENDING', () => {
      renderCard(
        makeProfile({ status: 'PENDING', industry: 'Fintech', enrichedAt: undefined }),
      );
      expect(screen.getByText('Fintech')).toBeInTheDocument();
    });

    it('shows fields instead of the loading skeleton while PROCESSING', () => {
      renderCard(
        makeProfile({
          status: 'PROCESSING',
          workPolicy: 'Hybrid',
          enrichedAt: undefined,
        }),
      );
      expect(screen.getByText('Hybrid')).toBeInTheDocument();
    });
  });

  describe('when status is COMPLETED', () => {
    it('shows industry when present', () => {
      renderCard(makeProfile({ industry: 'Fintech' }));
      expect(screen.getByText('Fintech')).toBeInTheDocument();
    });

    it('shows company size when present', () => {
      renderCard(makeProfile({ companySize: '501-1000' }));
      expect(screen.getByText('501-1000')).toBeInTheDocument();
    });

    it('renders tech stack as individual badges', () => {
      renderCard(makeProfile({ techStack: ['TypeScript', 'React', 'NestJS'] }));
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
      expect(screen.getByText('React')).toBeInTheDocument();
      expect(screen.getByText('NestJS')).toBeInTheDocument();
    });

    it('omits the Tech Stack section when techStack is empty', () => {
      renderCard(makeProfile({ techStack: [] }));
      expect(screen.queryByText('Tech Stack')).not.toBeInTheDocument();
    });

    it('shows the row with "Unknown" for a field the backend sent as null', () => {
      renderCard(
        makeProfile({
          industry: null,
          companySize: 'Startup (<50)',
          workPolicy: 'known',
        }),
      );
      expect(screen.getByText('Industry')).toBeInTheDocument();
      expect(screen.getByText('Startup (<50)')).toBeInTheDocument();
      expect(screen.getAllByText('Unknown')).toHaveLength(1);
    });

    it('deduplicates tech stack entries so each badge appears once', () => {
      renderCard(
        makeProfile({ techStack: ['TypeScript', 'React', 'TypeScript'] }),
      );
      expect(screen.getAllByText('TypeScript')).toHaveLength(1);
      expect(screen.getByText('React')).toBeInTheDocument();
    });

    it('shows remote policy when present', () => {
      renderCard(makeProfile({ workPolicy: 'Fully remote' }));
      expect(screen.getByText('Fully remote')).toBeInTheDocument();
    });

    it('shows a Refresh button', () => {
      renderCard(makeProfile());
      expect(
        screen.getByRole('button', { name: /refresh/i }),
      ).toBeInTheDocument();
    });

    it('calls POST /companies/:companyId/enrichment when Refresh is clicked', async () => {
      renderCard(makeProfile(), 'job-abc', 'company-abc');
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      await waitFor(() => {
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/companies/company-abc/enrichment',
        );
      });
    });
  });
});
