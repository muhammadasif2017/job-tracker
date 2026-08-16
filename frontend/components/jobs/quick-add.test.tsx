import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { QuickAdd } from './quick-add';

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

function renderQuickAdd(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <QuickAdd open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('QuickAdd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('disables the parse button until text is entered', () => {
    renderQuickAdd();
    expect(
      screen.getByRole('button', { name: /parse & continue/i }),
    ).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/paste the job description/i), {
      target: { value: 'Senior Engineer at Acme' },
    });
    expect(
      screen.getByRole('button', { name: /parse & continue/i }),
    ).not.toBeDisabled();
  });

  it('sends free text as {text} to /jobs/parse', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { company: 'Acme' } });
    renderQuickAdd();
    fireEvent.change(screen.getByPlaceholderText(/paste the job description/i), {
      target: { value: 'Senior Engineer at Acme' },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse & continue/i }));
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/jobs/parse',
        { text: 'Senior Engineer at Acme' },
        { timeout: 60_000 },
      ),
    );
  });

  it('sends a URL input as {url}', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { company: 'Acme' } });
    renderQuickAdd();
    fireEvent.change(screen.getByPlaceholderText(/paste the job description/i), {
      target: { value: 'https://acme.example/jobs/1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse & continue/i }));
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/jobs/parse',
        { url: 'https://acme.example/jobs/1' },
        { timeout: 60_000 },
      ),
    );
  });

  it('swaps to the job form pre-filled from the parsed result on success', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { company: 'Acme', position: 'Senior Engineer' },
    });
    renderQuickAdd();
    fireEvent.change(screen.getByPlaceholderText(/paste the job description/i), {
      target: { value: 'Senior Engineer at Acme' },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse & continue/i }));
    expect(await screen.findByText('Add Job')).toBeInTheDocument();
    expect(screen.getByLabelText(/company/i)).toHaveValue('Acme');
    expect(screen.getByLabelText(/position/i)).toHaveValue('Senior Engineer');
  });

  it('leaves the job-form field blank when the parser returns null for it', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { company: 'Acme', position: null, location: null },
    });
    renderQuickAdd();
    fireEvent.change(screen.getByPlaceholderText(/paste the job description/i), {
      target: { value: 'Some posting text' },
    });
    fireEvent.click(screen.getByRole('button', { name: /parse & continue/i }));
    expect(await screen.findByText('Add Job')).toBeInTheDocument();
    expect(screen.getByLabelText(/company/i)).toHaveValue('Acme');
    expect(screen.getByLabelText(/position/i)).toHaveValue('');
  });

  it('calls onClose without parsing when cancel is clicked', () => {
    const { onClose } = renderQuickAdd();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });
});
