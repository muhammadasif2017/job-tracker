import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ProfilePage from './page';
import type { User } from '../../../types';

const replace = vi.fn();
const setUser = vi.fn();
const logout = vi.fn();
let storeUser: User | null = null;

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

vi.mock('../../../store/auth.store', () => ({
  useAuthStore: () => ({ user: storeUser, setUser, logout }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/api', () => ({
  default: { get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
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

vi.mock('../../../components/profile/timezone-field', () => ({
  TimezoneField: ({
    registerProps,
    onUseBrowserTimezone,
  }: {
    registerProps: Record<string, unknown>;
    onUseBrowserTimezone: (tz: string) => void;
  }) => (
    <div>
      <input aria-label="Timezone" {...registerProps} />
      <button
        type="button"
        onClick={() => onUseBrowserTimezone('America/New_York')}
      >
        use-browser-timezone
      </button>
    </div>
  ),
}));

import api from '../../../lib/api';
import { toast } from 'sonner';

const profile: User = {
  id: 'u-1',
  email: 'jane@example.com',
  name: 'Jane Doe',
  hasPassword: true,
  connectedProviders: ['github'],
  interviewRemindersEnabled: true,
  digestFrequency: 'DAILY',
  timezone: 'America/Chicago',
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProfilePage />
    </QueryClientProvider>,
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeUser = null;
  });

  describe('loading fallback', () => {
    it('falls back to the store user while the profile query is pending', () => {
      storeUser = { id: 'u-1', email: 'jane@example.com', name: 'Jane Doe' };
      vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
      renderPage();
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      expect(screen.getByLabelText('Name')).toBeDisabled();
    });
  });

  describe('personal info', () => {
    it('renders the fetched profile and enables the name field', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      renderPage();
      expect(await screen.findByDisplayValue('Jane Doe')).toBeEnabled();
      expect(screen.getByText('J')).toBeInTheDocument();
    });

    it('shows a required error and never patches on a blank name', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      expect(await screen.findByText('Name is required')).toBeInTheDocument();
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    });

    it('patches the name and updates the store on success', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.patch).mockResolvedValue({
        data: { ...profile, name: 'Jane Smith' },
      });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.change(screen.getByLabelText('Name'), {
        target: { value: 'Jane Smith' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith('/users/me', {
          name: 'Jane Smith',
        }),
      );
      expect(setUser).toHaveBeenCalledWith({ ...profile, name: 'Jane Smith' });
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Profile updated');
    });

    it('shows the server error message on failure', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.patch).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Name already taken' } },
      });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Name already taken',
        ),
      );
    });
  });

  describe('notification preferences', () => {
    it('pre-fills reminder checkbox, digest frequency, and timezone from the profile', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      expect(
        screen.getByRole('checkbox', {
          name: /email me a reminder before scheduled interviews/i,
        }),
      ).toBeChecked();
      expect(screen.getByLabelText('Email digest')).toHaveValue('DAILY');
      expect(screen.getByLabelText('Timezone')).toHaveValue('America/Chicago');
    });

    it('saves preferences, including a timezone set via "use my timezone"', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.patch).mockResolvedValue({ data: profile });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.click(
        screen.getByRole('button', { name: /use-browser-timezone/i }),
      );
      fireEvent.change(screen.getByLabelText('Email digest'), {
        target: { value: 'WEEKLY' },
      });
      fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          '/users/me/notifications',
          {
            interviewRemindersEnabled: true,
            digestFrequency: 'WEEKLY',
            timezone: 'America/New_York',
          },
        ),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Notification preferences updated',
      );
    });

    it('shows a generic error toast on failure', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.patch).mockRejectedValue(new Error('network down'));
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.click(screen.getByRole('button', { name: /save preferences/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to update notification preferences',
        ),
      );
    });
  });

  describe('connected accounts', () => {
    it('shows Connected for a linked provider', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      expect(screen.getByText('github')).toBeInTheDocument();
      expect(screen.getByText('Connected')).toBeInTheDocument();
    });

    it('shows Not connected and hides the section without any providers', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: { ...profile, connectedProviders: [] },
      });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      expect(screen.queryByText('Connected Accounts')).not.toBeInTheDocument();
    });
  });

  describe('change password', () => {
    it('renders only when the profile has a password', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: { ...profile, hasPassword: false },
      });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      expect(screen.queryByText('Change Password')).not.toBeInTheDocument();
    });

    it('validates minimum length and matching confirmation', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.change(screen.getByLabelText('Current password'), {
        target: { value: 'old-pass' },
      });
      fireEvent.change(screen.getByLabelText('New password'), {
        target: { value: 'short' },
      });
      fireEvent.change(screen.getByLabelText('Confirm new password'), {
        target: { value: 'short' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /update password/i }),
      );
      expect(await screen.findByText('Min 8 characters')).toBeInTheDocument();
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();

      fireEvent.change(screen.getByLabelText('New password'), {
        target: { value: 'longenough1' },
      });
      fireEvent.change(screen.getByLabelText('Confirm new password'), {
        target: { value: 'different1' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /update password/i }),
      );
      expect(
        await screen.findByText("Passwords don't match"),
      ).toBeInTheDocument();
      expect(vi.mocked(api.patch)).not.toHaveBeenCalled();
    });

    it('changes the password and resets the form on success', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.patch).mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.change(screen.getByLabelText('Current password'), {
        target: { value: 'old-pass' },
      });
      fireEvent.change(screen.getByLabelText('New password'), {
        target: { value: 'longenough1' },
      });
      fireEvent.change(screen.getByLabelText('Confirm new password'), {
        target: { value: 'longenough1' },
      });
      fireEvent.click(
        screen.getByRole('button', { name: /update password/i }),
      );
      await waitFor(() =>
        expect(vi.mocked(api.patch)).toHaveBeenCalledWith(
          '/users/me/password',
          { currentPassword: 'old-pass', newPassword: 'longenough1' },
        ),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('Password changed');
      await waitFor(() =>
        expect(screen.getByLabelText('Current password')).toHaveValue(''),
      );
    });
  });

  describe('delete account', () => {
    it('cancels without deleting', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
      expect(await screen.findByText('Delete account?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() =>
        expect(screen.queryByText('Delete account?')).not.toBeInTheDocument(),
      );
      expect(vi.mocked(api.delete)).not.toHaveBeenCalled();
    });

    it('deletes, logs out, and redirects to /login on confirm', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
      await screen.findByText('Delete account?');
      fireEvent.click(
        screen.getByRole('button', { name: /yes, delete my account/i }),
      );
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/users/me'),
      );
      expect(logout).toHaveBeenCalled();
      expect(replace).toHaveBeenCalledWith('/login');
    });

    it('shows an error toast on failure', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: profile });
      vi.mocked(api.delete).mockRejectedValue(new Error('network down'));
      renderPage();
      await screen.findByDisplayValue('Jane Doe');
      fireEvent.click(screen.getByRole('button', { name: /delete account/i }));
      await screen.findByText('Delete account?');
      fireEvent.click(
        screen.getByRole('button', { name: /yes, delete my account/i }),
      );
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Failed to delete account',
        ),
      );
      expect(logout).not.toHaveBeenCalled();
    });
  });
});
