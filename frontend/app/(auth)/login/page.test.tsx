import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LoginPage from './page';

const replace = vi.fn();
const setAuth = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
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

import api from '../../../lib/api';
import { toast } from 'sonner';

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the OAuth button, email/password fields, and a link to register', () => {
    render(<LoginPage />);
    expect(
      screen.getByRole('link', { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /create one/i })).toHaveAttribute(
      'href',
      '/register',
    );
  });

  it('shows validation errors on blank submit and never calls the API', async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(screen.getByText('Password is required')).toBeInTheDocument();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('shows an error for a malformed email', async () => {
    // fireEvent.submit (not a button click) bypasses the browser's native
    // type="email" constraint validation, which would otherwise block the
    // submit event before RHF/Zod ever runs for a value like this one.
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'secret123' },
    });
    fireEvent.submit(document.querySelector('form')!);
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('never posts when a real user clicks submit with a malformed email', async () => {
    // The real interaction path: the browser's native type="email"
    // constraint blocks the submit event before Zod ever runs, so this only
    // pins that api.post still isn't reached for that value.
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('logs in, sets auth, and redirects home on success', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { accessToken: 'tok-1' } });
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'u-1', name: 'Jane', email: 'jane@example.com' },
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith('/auth/login', {
        email: 'jane@example.com',
        password: 'secret123',
      }),
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

  it('shows the server error message on failed login', async () => {
    vi.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Invalid credentials' } },
    });
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'wrong-pass' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Invalid credentials',
      ),
    );
    expect(setAuth).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('falls back to a generic error message on a non-axios failure', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network down'));
    render(<LoginPage />);
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^password$/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Login failed'),
    );
  });
});
