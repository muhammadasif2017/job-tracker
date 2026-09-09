import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Sidebar } from './sidebar';
import type { User } from '../../types';

const logout = vi.fn();
const { clearAuthStorage } = vi.hoisted(() => ({
  clearAuthStorage: vi.fn(),
}));
let mockUser: User | null = null;
let mockPathname = '/jobs';

vi.mock('next/link', () => ({
  // Forwards the remaining props (aria-current, className) so active-state
  // assertions see what the real anchor would render.
  default: ({
    href,
    children,
    onClick,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} onClick={onClick} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

vi.mock('../../store/auth.store', () => ({
  useAuthStore: (selector?: (s: unknown) => unknown) => {
    const state = { user: mockUser, logout };
    return selector ? selector(state) : state;
  },
  clearAuthStorage,
}));

vi.mock('../../lib/api', () => ({
  default: { post: vi.fn() },
}));

// The badge's data source. Stubbed rather than wrapped in a QueryClient so
// this file stays a pure nav test — the hook's own gating and caching are
// exercised through the panel's tests.
const { useAdminQueuesQuery } = vi.hoisted(() => ({
  useAdminQueuesQuery: vi.fn(),
}));
vi.mock('../../features/admin/hooks', () => ({ useAdminQueuesQuery }));

import api from '../../lib/api';

describe('Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { href: '' },
    });
    mockUser = {
      id: 'u-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      role: 'USER',
    };
    useAdminQueuesQuery.mockReturnValue({ data: undefined });
    mockPathname = '/jobs';
  });

  it('renders the standard nav items but not Admin for a regular user', () => {
    render(<Sidebar isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute(
      'href',
      '/',
    );
    expect(screen.getByRole('link', { name: /^jobs$/i })).toHaveAttribute(
      'href',
      '/jobs',
    );
    expect(screen.getByRole('link', { name: /companies/i })).toHaveAttribute(
      'href',
      '/companies',
    );
    expect(screen.getByRole('link', { name: /profile/i })).toHaveAttribute(
      'href',
      '/profile',
    );
    expect(
      screen.queryByRole('link', { name: /admin/i }),
    ).not.toBeInTheDocument();
  });

  it('adds the Admin nav item for an ADMIN user', () => {
    mockUser = {
      id: 'u-1',
      name: 'Jane Doe',
      email: 'jane@example.com',
      role: 'ADMIN',
    };
    render(<Sidebar isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute(
      'href',
      '/admin/users',
    );
  });

  // The Admin item links to its first tab, so a plain startsWith(href) check
  // dropped the highlight the moment you opened the Queues tab.
  describe('active highlighting', () => {
    function renderAsAdminAt(pathname: string) {
      mockPathname = pathname;
      mockUser = {
        id: 'u-1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'ADMIN',
      };
      render(<Sidebar isOpen onClose={vi.fn()} />);
    }

    it('keeps Admin highlighted on the Users tab', () => {
      renderAsAdminAt('/admin/users');
      expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('keeps Admin highlighted on the Queues tab', () => {
      renderAsAdminAt('/admin/queues');
      expect(screen.getByRole('link', { name: /admin/i })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('does not highlight Admin from an unrelated route', () => {
      renderAsAdminAt('/jobs');
      expect(screen.getByRole('link', { name: /admin/i })).not.toHaveAttribute(
        'aria-current',
      );
      expect(screen.getByRole('link', { name: /^jobs$/i })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('highlights Dashboard only on the root path', () => {
      mockPathname = '/jobs';
      render(<Sidebar isOpen onClose={vi.fn()} />);
      expect(
        screen.getByRole('link', { name: /dashboard/i }),
      ).not.toHaveAttribute('aria-current');
    });
  });

  describe('stranded-enrichment badge', () => {
    function renderAsAdmin(strandedPending: number | null) {
      mockUser = {
        id: 'u-1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        role: 'ADMIN',
      };
      useAdminQueuesQuery.mockReturnValue({ data: { strandedPending } });
      render(<Sidebar isOpen onClose={vi.fn()} />);
    }

    it('shows the count on the Admin item when companies are stranded', () => {
      renderAsAdmin(3);
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('stays hidden when nothing is stranded', () => {
      renderAsAdmin(0);
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    // null means the enrichment queue is unreachable, so the count is unknown
    // — an unknown must not render as an alarm.
    it('stays hidden when detection is unavailable', () => {
      renderAsAdmin(null);
      expect(
        screen.getByRole('link', { name: /admin/i }).textContent,
      ).not.toMatch(/\d/);
    });

    it('never queries the admin-only endpoint for a regular user', () => {
      render(<Sidebar isOpen onClose={vi.fn()} />);
      expect(useAdminQueuesQuery).toHaveBeenCalledWith(false);
    });
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
    await waitFor(() =>
      expect(vi.mocked(api.post)).toHaveBeenCalledWith('/auth/logout'),
    );
    expect(clearAuthStorage).toHaveBeenCalled();
    expect(window.location.href).toBe('/login');
    // The reactive clear would re-render the mounted page with user: null,
    // blanking the profile before the browser navigates away.
    expect(logout).not.toHaveBeenCalled();
  });

  it('still logs out locally even if the logout request fails', async () => {
    vi.mocked(api.post).mockRejectedValue(new Error('network down'));
    render(<Sidebar isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    await waitFor(() => expect(clearAuthStorage).toHaveBeenCalled());
    expect(window.location.href).toBe('/login');
    expect(logout).not.toHaveBeenCalled();
  });
});
