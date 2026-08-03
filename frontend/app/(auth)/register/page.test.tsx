import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import RegisterPage from './page';

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
}));

import api from '../../../lib/api';
import { toast } from 'sonner';

async function fillValid() {
  fireEvent.change(screen.getByLabelText(/^name$/i), {
    target: { value: 'Jane Doe' },
  });
  fireEvent.change(screen.getByLabelText(/^email$/i), {
    target: { value: 'jane@example.com' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), {
    target: { value: 'longenough1' },
  });
  fireEvent.change(screen.getByLabelText(/confirm password/i), {
    target: { value: 'longenough1' },
  });
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the OAuth button, all fields, and a link to login', () => {
    render(<RegisterPage />);
    expect(
      screen.getByRole('link', { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm password/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      '/login',
    );
  });

  it('shows validation errors on blank submit and never calls the API', async () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(await screen.findByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email')).toBeInTheDocument();
    expect(
      screen.getByText('Password must be at least 8 characters'),
    ).toBeInTheDocument();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('shows a mismatch error when confirm does not match password', async () => {
    render(<RegisterPage />);
    await fillValid();
    fireEvent.change(screen.getByLabelText(/confirm password/i), {
      target: { value: 'different1' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    expect(
      await screen.findByText("Passwords don't match"),
    ).toBeInTheDocument();
    expect(vi.mocked(api.post)).not.toHaveBeenCalled();
  });

  it('registers, sets auth, and redirects home on success', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { accessToken: 'tok-1' } });
    vi.mocked(api.get).mockResolvedValue({
      data: { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com' },
    });
    render(<RegisterPage />);
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith('/auth/register', {
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'longenough1',
      }),
    );
    expect(vi.mocked(api.get)).toHaveBeenCalledWith('/auth/me', {
      headers: { Authorization: 'Bearer tok-1' },
    });
    await waitFor(() =>
      expect(setAuth).toHaveBeenCalledWith(
        { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com' },
        'tok-1',
      ),
    );
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('shows the server error message on failed registration', async () => {
    vi.mocked(api.post).mockRejectedValue({
      isAxiosError: true,
      response: { data: { message: 'Email already registered' } },
    });
    render(<RegisterPage />);
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Email already registered',
      ),
    );
    expect(setAuth).not.toHaveBeenCalled();
  });

  it('falls back to a generic error message on a non-axios failure', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network down'));
    render(<RegisterPage />);
    await fillValid();
    fireEvent.click(screen.getByRole('button', { name: /create account/i }));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Registration failed',
      ),
    );
  });
});
