import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import CallbackPage from './page';

const replace = vi.fn();
const setAuth = vi.fn();
let params = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => params,
}));

vi.mock('../../../store/auth.store', () => ({
  useAuthStore: (selector: (s: { setAuth: typeof setAuth }) => unknown) =>
    selector({ setAuth }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

import api from '../../../lib/api';
import { toast } from 'sonner';

describe('CallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    params = new URLSearchParams();
  });

  it('always renders the signing-in message', () => {
    render(<CallbackPage />);
    expect(screen.getByText('Signing you in…')).toBeInTheDocument();
  });

  it('redirects to /login without calling the API when there is no code', async () => {
    render(<CallbackPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      'Authentication failed. Please try again.',
    );
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('redirects to /login when the provider returns an error param, even with a code', async () => {
    params = new URLSearchParams({ code: 'abc', error: 'access_denied' });
    render(<CallbackPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('exchanges the code, sets auth, and redirects home on success', async () => {
    params = new URLSearchParams({ code: 'abc123' });
    vi.mocked(api.post).mockResolvedValue({ data: { accessToken: 'tok-1' } });
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'u-1', name: 'Jane', email: 'jane@example.com' },
    });
    render(<CallbackPage />);
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith(
        '/auth/exchange-code',
        { code: 'abc123' },
      ),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/auth/me', {
      headers: { Authorization: 'Bearer tok-1' },
    });
    await waitFor(() =>
      expect(setAuth).toHaveBeenCalledWith(
        { id: 'u-1', name: 'Jane', email: 'jane@example.com' },
        'tok-1',
      ),
    );
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('shows an error and redirects to /login when the exchange fails', async () => {
    params = new URLSearchParams({ code: 'abc123' });
    vi.mocked(api.post).mockRejectedValue(new Error('invalid code'));
    render(<CallbackPage />);
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Could not complete sign-in. Please try again.',
      ),
    );
    expect(replace).toHaveBeenCalledWith('/login');
    expect(setAuth).not.toHaveBeenCalled();
  });
});
