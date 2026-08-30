import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useResumeQuery,
  useUploadResumeMutation,
  useRemoveResumeMutation,
} from './resume.hooks';
import type { Resume } from '../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
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

const resume: Resume = {
  id: 'r-1',
  jobId: 'j-1',
  originalName: 'my-cv.pdf',
  size: 102400,
  createdAt: '2026-01-01T00:00:00Z',
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useResumeQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not call the API when jobId is null', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResumeQuery(null, null), { wrapper });
    expect(result.current.fetchStatus).toBe('idle');
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('seeds the cache from initialResume without hitting the API', () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResumeQuery('j-1', resume), { wrapper });
    expect(result.current.data).toEqual(resume);
    expect(vi.mocked(api.get)).not.toHaveBeenCalled();
  });

  it('fetches from the API when no initialResume is passed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: resume });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResumeQuery('j-1'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(resume));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/jobs/j-1/resumes');
  });

  it('resolves to null instead of erroring when the backend 404s (no resume for this job)', async () => {
    vi.mocked(api.get).mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResumeQuery('j-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(result.current.isError).toBe(false);
  });

  it('still surfaces a non-404 failure as an error', async () => {
    vi.mocked(api.get).mockRejectedValue({
      isAxiosError: true,
      response: { status: 500 },
    });
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useResumeQuery('j-1'), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useUploadResumeMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('writes the uploaded resume into the ["resume", jobId] cache on success', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: resume });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadResumeMutation('j-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(new File(['x'], 'cv.pdf'));
    });

    expect(qc.getQueryData(['resume', 'j-1'])).toEqual(resume);
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Resume uploaded');
  });

  it('leaves the cache untouched and toasts on failure', async () => {
    vi.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Too large' } },
    });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useUploadResumeMutation('j-1'), { wrapper });

    await act(async () => {
      await result.current.mutateAsync(new File(['x'], 'cv.pdf')).catch(() => {});
    });

    expect(qc.getQueryData(['resume', 'j-1'])).toBeUndefined();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Too large');
  });
});

describe('useRemoveResumeMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the ["resume", jobId] cache to null on success and runs onSettled', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: {} });
    const { qc, wrapper } = makeWrapper();
    qc.setQueryData(['resume', 'j-1'], resume);
    const onSettled = vi.fn();
    const { result } = renderHook(() => useRemoveResumeMutation('j-1', onSettled), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(qc.getQueryData(['resume', 'j-1'])).toBeNull();
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Resume removed');
    expect(onSettled).toHaveBeenCalled();
  });

  it('toasts and still runs onSettled on failure, without touching the cache', async () => {
    vi.mocked(api.delete).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Not found' } },
    });
    const { qc, wrapper } = makeWrapper();
    qc.setQueryData(['resume', 'j-1'], resume);
    const onSettled = vi.fn();
    const { result } = renderHook(() => useRemoveResumeMutation('j-1', onSettled), {
      wrapper,
    });

    await act(async () => {
      await result.current.mutateAsync().catch(() => {});
    });

    expect(qc.getQueryData(['resume', 'j-1'])).toEqual(resume);
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Not found');
    expect(onSettled).toHaveBeenCalled();
  });
});
