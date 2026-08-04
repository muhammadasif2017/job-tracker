import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JobForm } from './job-form';
import type { Job } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
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

const job: Job = {
  id: 'j-1',
  company: 'Acme',
  position: 'Senior Engineer',
  location: 'Remote',
  url: 'https://acme.example/jobs/1',
  status: 'INTERVIEWING',
  priority: 'HIGH',
  jobType: 'REMOTE',
  discoverySource: 'LINKEDIN',
  applicationChannel: 'REFERRAL',
  notes: 'Great referral from Bob',
  appliedAt: '2026-06-01T00:00:00Z',
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-01T00:00:00Z',
  userId: 'u-1',
};

function renderForm(props: Partial<React.ComponentProps<typeof JobForm>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = props.onClose ?? vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <JobForm open onClose={onClose} {...props} />
    </QueryClientProvider>,
  );
  return { onClose };
}

async function fillRequired() {
  fireEvent.change(screen.getByLabelText(/company/i), {
    target: { value: 'Acme' },
  });
  fireEvent.change(screen.getByLabelText(/position/i), {
    target: { value: 'Senior Engineer' },
  });
}

describe('JobForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create mode', () => {
    it('renders the Add Job title and Add job button', () => {
      renderForm();
      expect(screen.getByText('Add Job')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /add job/i }),
      ).toBeInTheDocument();
    });

    it('renders required fields blank', () => {
      renderForm();
      expect(screen.getByLabelText(/company/i)).toHaveValue('');
      expect(screen.getByLabelText(/position/i)).toHaveValue('');
    });
  });

  describe('edit mode', () => {
    it('renders the Edit Job title and Save changes button', () => {
      renderForm({ job });
      expect(screen.getByText('Edit Job')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /save changes/i }),
      ).toBeInTheDocument();
    });

    it('pre-fills fields from the job prop', () => {
      renderForm({ job });
      expect(screen.getByLabelText(/company/i)).toHaveValue('Acme');
      expect(screen.getByLabelText(/position/i)).toHaveValue(
        'Senior Engineer',
      );
      expect(screen.getByLabelText(/job url/i)).toHaveValue(
        'https://acme.example/jobs/1',
      );
    });
  });

  describe('validation', () => {
    it('shows required-field errors when submitting blank', async () => {
      renderForm();
      fireEvent.click(screen.getByRole('button', { name: /add job/i }));
      expect(
        await screen.findByText('Company is required'),
      ).toBeInTheDocument();
      expect(screen.getByText('Position is required')).toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('shows an error for an invalid URL', async () => {
      renderForm();
      await fillRequired();
      fireEvent.change(screen.getByLabelText(/job url/i), {
        target: { value: 'not-a-url' },
      });
      // Modal renders into a Radix portal on document.body, outside RTL's
      // container, so query the form from the document.
      fireEvent.submit(document.querySelector('form')!);
      expect(
        await screen.findByText('Enter a valid URL'),
      ).toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('shows the same error via a real button click, not just synthetic submit', async () => {
      // The form has `noValidate` specifically so a real click also reaches
      // Zod instead of being silently swallowed by the browser's native
      // type="url" constraint validation before RHF ever runs — this is
      // the actual regression guard for that: without `noValidate`, this
      // click would be blocked pre-React and the message below would never
      // appear.
      renderForm();
      await fillRequired();
      fireEvent.change(screen.getByLabelText(/job url/i), {
        target: { value: 'not-a-url' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add job/i }));
      expect(
        await screen.findByText('Enter a valid URL'),
      ).toBeInTheDocument();
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });
  });

  describe('create submit', () => {
    it('posts the payload with empty optional fields coerced to undefined', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'new-job' } });
      renderForm();
      await fillRequired();
      fireEvent.click(screen.getByRole('button', { name: /add job/i }));
      await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalled());
      const [url, payload] = vi.mocked(api.post).mock.calls[0];
      expect(url).toBe('/jobs');
      expect(payload).toMatchObject({
        company: 'Acme',
        position: 'Senior Engineer',
        url: undefined,
        discoverySource: undefined,
        applicationChannel: undefined,
      });
    });

    it('shows a success toast and stays open on the resume-attach step', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'new-job' } });
      const { onClose } = renderForm();
      await fillRequired();
      fireEvent.click(screen.getByRole('button', { name: /add job/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Job added'),
      );
      expect(screen.getByText('Job Added')).toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('edit submit', () => {
    it('patches the job and closes on success', async () => {
      vi.mocked(api.patch).mockResolvedValue({ data: job });
      const { onClose } = renderForm({ job });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          '/jobs/j-1',
          expect.objectContaining({ company: 'Acme' }),
        ),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Job updated');
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('shows the server error message in a toast', async () => {
      vi.mocked(api.post).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Duplicate job' } },
      });
      renderForm();
      await fillRequired();
      fireEvent.click(screen.getByRole('button', { name: /add job/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Duplicate job'),
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
