import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Sidebar } from './sidebar';
import type { User } from '../../types';

const replace = vi.fn();
const logout = vi.fn();
let mockUser: User | null = null;

vi.mock('next/link', () => ({
  default: ({ href, children, onClick }: { href: string; children: React.ReactNode; onClick?: () => void }) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/jobs',
  useRouter: () => ({ replace }),
}));

vi.mock('../../store/auth.store', () => ({
  useAuthStore: () => ({ user: mockUser, logout }),
}));

vi.mock('../../lib/api', () => ({
  default: { post: vi.fn() },
}));

import api from '../../lib/api';

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'USER' };
  });

  it('renders the standard nav items but not Admin for a regular user', () => {
    render(<Sidebar isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /^jobs$/i })).toHaveAttribute('href', '/jobs');
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute('href', '/profile');
    expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
  });

  it('adds the Admin nav item for an ADMIN user', () => {
    mockUser = { id: 'u-1', name: 'Jane Doe', email: 'jane@example.com', role: 'ADMIN' };
    render(<Sidebar isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute(
      'href',
      '/admin/users',
    );
  });

  it('shows the current user name and email', () => {
    render(<Sidebar isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
  });

  it('logs out, clears auth, and redirects to login on sign out', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: {} });
    render(<Sidebar isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(vi.mocked(api.post)).toHaveBeenCalledWith('/auth/logout'));
    expect(logout).toHaveBeenCalled();
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('still logs out locally even if the logout request fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network down'));
    render(<Sidebar isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
