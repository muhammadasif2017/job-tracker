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
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CompanyProfileCard profile={profile} jobId={jobId} />
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
    it('shows the raw errorMessage when it does not match a known failure kind', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage: 'Unexpected tool-call shape from LLM',
        }),
      );
      expect(
        screen.getByText('Unexpected tool-call shape from LLM'),
      ).toBeInTheDocument();
    });

    it('shows fallback message when errorMessage is absent', () => {
      renderCard(makeProfile({ status: 'FAILED' }));
      expect(
        screen.getByText('Enrichment failed. Try again.'),
      ).toBeInTheDocument();
    });

    it('shows a friendly rate-limit message for a 429', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage:
            '429 {"error":{"message":"Rate limit reached for model..."}}',
        }),
      );
      expect(
        screen.getByText(/Daily quota reached for company research/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/429/)).not.toBeInTheDocument();
    });

    it('shows a friendly unavailable message for a timeout', () => {
      renderCard(
        makeProfile({ status: 'FAILED', errorMessage: 'API timeout' }),
      );
      expect(
        screen.getByText(/temporarily unreachable/),
      ).toBeInTheDocument();
      expect(screen.queryByText('API timeout')).not.toBeInTheDocument();
    });

    it('shows a friendly unavailable message for a connection error', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage: 'connect ECONNREFUSED 127.0.0.1:443',
        }),
      );
      expect(
        screen.getByText(/temporarily unreachable/),
      ).toBeInTheDocument();
    });

    it('shows a friendly config message for an auth error', () => {
      renderCard(
        makeProfile({
          status: 'FAILED',
          errorMessage: '401 Invalid API Key provided',
        }),
      );
      expect(
        screen.getByText(/isn't configured correctly/),
      ).toBeInTheDocument();
    });

    it('shows a Refresh button', () => {
      renderCard(makeProfile({ status: 'FAILED' }));
      expect(
        screen.getByRole('button', { name: /refresh/i }),
      ).toBeInTheDocument();
    });

    it('calls POST /jobs/:id/enrichment when Refresh is clicked', async () => {
      renderCard(makeProfile({ status: 'FAILED' }), 'job-xyz');
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      await waitFor(() => {
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/jobs/job-xyz/enrichment',
        );
      });
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

    it('shows headquarters when present', () => {
      renderCard(makeProfile({ headquarters: 'San Francisco, CA' }));
      expect(screen.getByText('San Francisco, CA')).toBeInTheDocument();
    });

    it('shows founded year when present', () => {
      renderCard(makeProfile({ founded: '2012' }));
      expect(screen.getByText('2012')).toBeInTheDocument();
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

    it('shows work-life balance when present', () => {
      renderCard(makeProfile({ workLifeBalance: 'Flexible hours' }));
      expect(screen.getByText('Flexible hours')).toBeInTheDocument();
    });

    it('shows culture summary when present', () => {
      renderCard(makeProfile({ cultureSummary: 'Strong engineering culture' }));
      expect(
        screen.getByText('Strong engineering culture'),
      ).toBeInTheDocument();
    });

    it('shows a Refresh button', () => {
      renderCard(makeProfile());
      expect(
        screen.getByRole('button', { name: /refresh/i }),
      ).toBeInTheDocument();
    });

    it('calls POST /jobs/:id/enrichment when Refresh is clicked', async () => {
      renderCard(makeProfile(), 'job-abc');
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      await waitFor(() => {
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/jobs/job-abc/enrichment',
        );
      });
    });
  });
});
