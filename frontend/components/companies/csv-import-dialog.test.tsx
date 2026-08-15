import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CsvImportDialog } from './csv-import-dialog';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
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

function makeCsvFile(name = 'companies.csv'): File {
  return new File(['name,city,businessMode\nAcme,LAHORE,SERVICES'], name, {
    type: 'text/csv',
  });
}

function renderDialog(onClose = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CsvImportDialog open onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('CsvImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the file input and disables Import until a file is chosen', () => {
    renderDialog();
    expect(screen.getByLabelText('CSV file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
  });

  it('enables Import once a file is selected', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [makeCsvFile()] },
    });
    expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled();
  });

  it('posts the selected file to /companies/import as multipart form data', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { imported: 1, errors: [] },
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [makeCsvFile()] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/companies/import',
        expect.any(FormData),
        expect.objectContaining({
          headers: { 'Content-Type': 'multipart/form-data' },
        }),
      );
    });
  });

  it('shows a success toast and the imported count when there are no errors', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { imported: 3, errors: [] },
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [makeCsvFile()] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Imported 3 companies',
      ),
    );
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows a warning toast and the per-row error table when some rows are skipped', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        imported: 1,
        errors: [{ row: 3, message: 'Duplicate company name "Acme"' }],
      },
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [makeCsvFile()] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() =>
      expect(vi.mocked(toast.warning)).toHaveBeenCalledWith(
        'Imported 1 companies, 1 row(s) skipped',
      ),
    );
    expect(screen.getByText('Duplicate company name "Acme"')).toBeInTheDocument();
  });

  it('shows an error toast and keeps the file picker when the import request fails', async () => {
    vi.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'CSV file is empty' } },
    });
    renderDialog();
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [makeCsvFile()] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('CSV file is empty'),
    );
    expect(screen.getByLabelText('CSV file')).toBeInTheDocument();
  });

  it('calls onClose without importing when Cancel is clicked', () => {
    const { onClose } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('resets file selection and result when closed via Done', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { imported: 1, errors: [] },
    });
    const onClose = vi.fn();
    renderDialog(onClose);
    fireEvent.change(screen.getByLabelText('CSV file'), {
      target: { files: [makeCsvFile()] },
    });
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }));
    await screen.findByRole('button', { name: /^done$/i });

    fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
