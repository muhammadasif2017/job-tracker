import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ResumeUpload } from './resume-upload';
import type { Resume } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

import api from '../../lib/api';
import { toast } from 'sonner';

const resume: Resume = {
  id: 'r-1',
  jobId: 'j-1',
  originalName: 'my-cv.pdf',
  size: 102400,
  createdAt: '2026-01-01T00:00:00Z',
};

function renderUpload(jobId: string | null, initialResume?: Resume | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ResumeUpload jobId={jobId} initialResume={initialResume} />
    </QueryClientProvider>,
  );
}

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'.repeat(size)], name, { type });
  return file;
}

describe('ResumeUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('when jobId is null', () => {
    it('renders nothing', () => {
      const { container } = renderUpload(null, null);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('when no resume is attached', () => {
    it('shows the Attach Resume button', () => {
      renderUpload('j-1', null);
      expect(
        screen.getByRole('button', { name: /attach resume/i }),
      ).toBeInTheDocument();
    });

    it('does not show resume filename or action buttons', () => {
      renderUpload('j-1', null);
      expect(
        screen.queryByRole('button', { name: /view/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /remove/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('when a resume is attached', () => {
    it('shows the original filename', () => {
      renderUpload('j-1', resume);
      expect(screen.getByText('my-cv.pdf')).toBeInTheDocument();
    });

    it('shows the formatted file size', () => {
      renderUpload('j-1', resume);
      expect(screen.getByText('100 KB')).toBeInTheDocument();
    });

    it('shows View, Download, and Remove buttons', () => {
      renderUpload('j-1', resume);
      expect(screen.getByRole('button', { name: /view/i })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /download/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /remove/i }),
      ).toBeInTheDocument();
    });

    it('does not show the Attach Resume button', () => {
      renderUpload('j-1', resume);
      expect(
        screen.queryByRole('button', { name: /attach resume/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('file validation', () => {
    it('rejects non-PDF files with a toast error', () => {
      const { container } = renderUpload('j-1', null);
      const input = container.querySelector('input[type="file"]')!;
      const file = makeFile(
        'resume.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        1024,
      );
      fireEvent.change(input, { target: { files: [file] } });
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Only PDF files are allowed',
      );
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('rejects files larger than 8 MB with a toast error', () => {
      const { container } = renderUpload('j-1', null);
      const input = container.querySelector('input[type="file"]')!;
      const file = makeFile('big.pdf', 'application/pdf', 9 * 1024 * 1024);
      fireEvent.change(input, { target: { files: [file] } });
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'File must be under 8 MB',
      );
      expect(vi.mocked(api.post)).not.toHaveBeenCalled();
    });

    it('accepts a valid PDF under 8 MB and calls the upload API', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: resume });
      const { container } = renderUpload('j-1', null);
      const input = container.querySelector('input[type="file"]')!;
      const file = makeFile('cv.pdf', 'application/pdf', 512 * 1024);
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(vi.mocked(api.post)).toHaveBeenCalledWith(
          '/jobs/j-1/resumes',
          expect.any(FormData),
          expect.objectContaining({
            headers: { 'Content-Type': 'multipart/form-data' },
          }),
        );
      });
    });

    it('shows success toast after successful upload', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: resume });
      const { container } = renderUpload('j-1', null);
      const input = container.querySelector('input[type="file"]')!;
      const file = makeFile('cv.pdf', 'application/pdf', 512 * 1024);
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
          'Resume uploaded',
        );
      });
    });

    it('shows error toast when upload fails', async () => {
      vi.mocked(api.post).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Server error' } },
      });
      const { container } = renderUpload('j-1', null);
      const input = container.querySelector('input[type="file"]')!;
      const file = makeFile('cv.pdf', 'application/pdf', 512 * 1024);
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Server error');
      });
    });
  });

  describe('remove flow', () => {
    it('shows confirm UI when Remove is clicked', () => {
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      expect(screen.getByText(/remove resume\?/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /yes/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /no/i })).toBeInTheDocument();
    });

    it('cancels remove when No is clicked', () => {
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      fireEvent.click(screen.getByRole('button', { name: /no/i }));
      expect(screen.queryByText(/remove resume\?/i)).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /remove/i }),
      ).toBeInTheDocument();
    });

    it('calls DELETE when Yes is clicked', async () => {
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      fireEvent.click(screen.getByRole('button', { name: /yes/i }));
      await waitFor(() => {
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/jobs/j-1/resumes');
      });
    });

    it('shows success toast after successful remove', async () => {
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      fireEvent.click(screen.getByRole('button', { name: /yes/i }));
      await waitFor(() => {
        expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Resume removed');
      });
    });

    it('shows error toast when remove fails', async () => {
      vi.mocked(api.delete).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Not found' } },
      });
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /remove/i }));
      fireEvent.click(screen.getByRole('button', { name: /yes/i }));
      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Not found');
      });
    });
  });

  describe('view', () => {
    it('opens a new window with the presigned URL', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
      vi.mocked(api.get).mockResolvedValue({
        data: { url: 'https://signed.url/cv.pdf' },
      });
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /view/i }));
      await waitFor(() => {
        expect(openSpy).toHaveBeenCalledWith(
          'https://signed.url/cv.pdf',
          '_blank',
          'noopener,noreferrer',
        );
      });
      openSpy.mockRestore();
    });

    it('shows error toast when the URL fetch fails', async () => {
      vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
      renderUpload('j-1', resume);
      fireEvent.click(screen.getByRole('button', { name: /view/i }));
      await waitFor(() => {
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Could not open file',
        );
      });
    });
  });
});
