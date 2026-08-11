import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useTokensQuery,
  useCreateTokenMutation,
  useRevokeTokenMutation,
  type ApiToken,
  type CreatedApiToken,
} from './hooks';

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

const token: ApiToken = {
  id: 't-1',
  name: 'Chrome extension',
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  expiresAt: '2026-07-01T00:00:00Z',
};

const createdToken: CreatedApiToken = {
  ...token,
  token: 'jt_pat_id.secret',
};

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

describe('useTokensQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetches tokens under the ["tokens"] key', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [token] });
    const { qc, wrapper } = makeWrapper();
    const { result } = renderHook(() => useTokensQuery(), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual([token]));
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/tokens');
    expect(qc.getQueryData(['tokens'])).toEqual([token]);
  });
});

describe('useCreateTokenMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('posts the name, invalidates ["tokens"] on success, and returns the created token', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: createdToken });
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTokenMutation(), { wrapper });

    let returned: CreatedApiToken | undefined;
    await act(async () => {
      returned = await result.current.mutateAsync('Chrome extension');
    });

    expect(vi.mocked(api.post)).toHaveBeenCalledWith('/tokens', {
      name: 'Chrome extension',
    });
    expect(returned).toEqual(createdToken);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tokens'] });
    expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
  });

  it('toasts and does not invalidate on failure', async () => {
    vi.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Token limit reached (20)' } },
    });
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTokenMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('One too many').catch(() => {});
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Token limit reached (20)');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('useRevokeTokenMutation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes by id, invalidates ["tokens"], and toasts success', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { message: 'Token revoked' } });
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeTokenMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('t-1');
    });

    expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/tokens/t-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tokens'] });
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Token revoked');
  });

  it('toasts and does not invalidate on failure', async () => {
    vi.mocked(api.delete).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Token not found' } },
    });
    const { qc, wrapper } = makeWrapper();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const { result } = renderHook(() => useRevokeTokenMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync('t-x').catch(() => {});
    });

    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Token not found');
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
