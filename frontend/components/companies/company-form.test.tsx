import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CompanyForm } from './company-form';
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
import { toast } from 'sonner';

const baseCompany: Company = {
  id: 'c-1',
  name: 'Systems Limited',
  city: 'LAHORE',
  location: null,
  priority: 'HIGH',
  personalNotes: null,
  websiteUrl: null,
  linkedinUrl: null,
  businessMode: 'SERVICES',
  productDescription: null,
  status: null,
  industry: null,
  companySize: null,
  techStack: [],
  cultureSummary: null,
  workPolicy: null,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
};

function renderForm(props: Partial<React.ComponentProps<typeof CompanyForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CompanyForm open onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('CompanyForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create mode', () => {
    it('renders the Add Target Company title and Add company button', () => {
      renderForm();
      expect(screen.getByText('Add Target Company')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /add company/i }),
      ).toBeInTheDocument();
    });

    it('does not render the AI Research section', () => {
      renderForm();
      expect(screen.queryByText('AI Research')).not.toBeInTheDocument();
    });
  });

  describe('edit mode', () => {
    it('renders the Edit Target Company title and pre-fills fields', () => {
      renderForm({ company: baseCompany });
      expect(screen.getByText('Edit Target Company')).toBeInTheDocument();
      expect(screen.getByLabelText(/name/i)).toHaveValue('Systems Limited');
    });

    it('renders the AI Research section with a Research button when never enriched', () => {
      renderForm({ company: baseCompany });
      expect(screen.getByText('AI Research')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^research$/i }),
      ).toBeInTheDocument();
    });

    it('shows a Refresh button once enrichment has completed', () => {
      renderForm({ company: { ...baseCompany, status: 'COMPLETED' } });
      expect(
        screen.getByRole('button', { name: /^refresh$/i }),
      ).toBeInTheDocument();
    });

    it('disables the trigger button while enrichment is in progress', () => {
      renderForm({ company: { ...baseCompany, status: 'PROCESSING' } });
      expect(screen.getByRole('button', { name: /research/i })).toBeDisabled();
    });
  });

  describe('validation', () => {
    it('shows a required-field error when submitting blank', async () => {
      renderForm();
      fireEvent.click(screen.getByRole('button', { name: /add company/i }));
      expect(
        await screen.findByText('Name is required'),
      ).toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });
  });

  describe('create submit', () => {
    it('posts to /companies with the entered name and city', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'new-co' } });
      renderForm();
      fireEvent.change(screen.getByLabelText(/name/i), {
        target: { value: 'Devsinc' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add company/i }));
      await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
      const [url, payload] = vi.mocked(api.post).mock.calls[0];
      expect(url).toBe('/companies');
      expect(payload).toMatchObject({ name: 'Devsinc', city: 'LAHORE' });
    });

    it('shows a success toast and closes', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'new-co' } });
      const { onClose } = renderForm();
      fireEvent.change(screen.getByLabelText(/name/i), {
        target: { value: 'Devsinc' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add company/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Company added'),
      );
      expect(onClose).toHaveBeenCalled();
    });

    it('shows the duplicate-name error toast and stays open on a 409 conflict', async () => {
      vi.mocked(api.post).mockRejectedValue({
        isAxiosError: true,
        response: {
          data: { message: 'A company named "Devsinc" already exists' },
        },
      });
      const { onClose } = renderForm();
      fireEvent.change(screen.getByLabelText(/name/i), {
        target: { value: 'Devsinc' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add company/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'A company named "Devsinc" already exists',
        ),
      );
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('edit submit', () => {
    it('patches the company and closes on success', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: baseCompany });
      const { onClose } = renderForm({ company: baseCompany });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          '/companies/c-1',
          expect.objectContaining({ name: 'Systems Limited' }),
        ),
      );
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('enrichment trigger', () => {
    it('triggers enrichment immediately when never researched', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: {} });
      renderForm({ company: baseCompany });
      fireEvent.click(screen.getByRole('button', { name: /^research$/i }));
      await waitFor(() =>
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/companies/c-1/enrichment',
        ),
      );
    });

    it('shows a confirm dialog before refreshing an already-completed profile', async () => {
      renderForm({ company: { ...baseCompany, status: 'COMPLETED' } });
      fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
      expect(
        await screen.findByText('Refresh AI research?'),
      ).toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('only calls enrichment after confirming the refresh', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: {} });
      renderForm({ company: { ...baseCompany, status: 'COMPLETED' } });
      fireEvent.click(screen.getByRole('button', { name: /^refresh$/i }));
      fireEvent.click(
        await screen.findByRole('button', { name: /refresh anyway/i }),
      );
      await waitFor(() =>
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/companies/c-1/enrichment',
        ),
      );
    });
  });

  describe('cancel', () => {
    it('calls onClose without submitting', () => {
      const { onClose } = renderForm();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(onClose).toHaveBeenCalled();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });
  });
});
