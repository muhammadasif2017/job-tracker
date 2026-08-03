import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminUsersPage from './page';
import { formatDate } from '../../../../lib/utils';
import type { AdminUser, PaginatedAdminUsers } from '../../../../types';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../../lib/api', () => ({
  default: { get: vi.fn(), delete: vi.fn() },
}));

import api from '../../../../lib/api';
import { toast } from 'sonner';

const users: AdminUser[] = [
  {
    id: 'u-1',
    email: 'jane@example.com',
    name: 'Jane Doe',
    role: 'ADMIN',
    createdAt: '2026-06-01T00:00:00Z',
    jobCount: 12,
  },
  {
    id: 'u-2',
    email: 'bob@example.com',
    name: 'Bob Smith',
    role: 'USER',
    createdAt: '2026-05-15T00:00:00Z',
    jobCount: 3,
  },
];

function page(overrides: Partial<PaginatedAdminUsers> = {}): PaginatedAdminUsers {
  return {
    data: users,
    meta: { total: 2, page: 1, limit: 10, totalPages: 1 },
    ...overrides,
  };
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <AdminUsersPage />
    </QueryClientProvider>,
  );
}

function lastGetUrl() {
  const calls = vi.mocked(api.get).mock.calls;
  return calls[calls.length - 1][0] as string;
}

describe('AdminUsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows skeleton rows while the query is pending', () => {
      vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
      const { container } = render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <AdminUsersPage />
        </QueryClientProvider>,
      );
      expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    });
  });

  describe('empty state', () => {
    it('shows "No users found" when there are no users', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: page({ data: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      });
      renderPage();
      expect(await screen.findByText('No users found')).toBeInTheDocument();
    });
  });

  describe('list rendering', () => {
    it('renders name, email, role, job count, and joined date', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('jane@example.com')).toBeInTheDocument();
      expect(screen.getByText('ADMIN')).toBeInTheDocument();
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText(formatDate('2026-06-01T00:00:00Z'))).toBeInTheDocument();
      expect(screen.getByText('Bob Smith')).toBeInTheDocument();
      expect(screen.getByText('USER')).toBeInTheDocument();
      expect(screen.getByText('2 registered users')).toBeInTheDocument();
    });
  });

  describe('search', () => {
    it('debounces search input into the query params', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Jane Doe');
      fireEvent.change(screen.getByLabelText('Search users'), {
        target: { value: 'jane' },
      });
      await waitFor(() => expect(lastGetUrl()).toContain('search=jane'), {
        timeout: 1000,
      });
    });
  });

  describe('delete flow', () => {
    it('cancels without deleting', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      renderPage();
      await screen.findByText('Jane Doe');
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete jane@example.com' }),
      );
      expect(await screen.findByText('Delete user?')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() =>
        expect(screen.queryByText('Delete user?')).not.toBeInTheDocument(),
      );
      expect(vi.mocked(api.delete)).not.toHaveBeenCalled();
    });

    it('deletes on confirm and shows a success toast', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      vi.mocked(api.delete).mockResolvedValue({ data: {} });
      renderPage();
      await screen.findByText('Jane Doe');
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete bob@example.com' }),
      );
      await screen.findByText('Delete user?');
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(vi.mocked(api.delete)).toHaveBeenCalledWith('/admin/users/u-2'),
      );
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith('User deleted');
    });

    it('shows the server error message on failure', async () => {
      vi.mocked(api.get).mockResolvedValue({ data: page() });
      vi.mocked(api.delete).mockRejectedValue({
        isAxiosError: true,
        response: { data: { message: 'Cannot delete the last admin' } },
      });
      renderPage();
      await screen.findByText('Jane Doe');
      fireEvent.click(
        screen.getByRole('button', { name: 'Delete jane@example.com' }),
      );
      await screen.findByText('Delete user?');
      fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
      await waitFor(() =>
        expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
          'Cannot delete the last admin',
        ),
      );
    });
  });

  describe('pagination', () => {
    it('disables Previous on the first page and Next on the last', async () => {
      vi.mocked(api.get).mockResolvedValue({
        data: page({ meta: { total: 20, page: 1, limit: 10, totalPages: 2 } }),
      });
      renderPage();
      await screen.findByText('Jane Doe');
      expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /^next$/i })).not.toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
      await waitFor(() => expect(lastGetUrl()).toContain('page=2'));
      expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /previous/i })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^next$/i })).toBeDisabled();
    });
  });
});
