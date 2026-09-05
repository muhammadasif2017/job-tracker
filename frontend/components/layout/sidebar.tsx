'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/utils';
import { useAuthStore } from '../../store/auth.store';
import api from '../../lib/api';
import { useRouter } from 'next/navigation';
import {
  LogoMark,
  IconDashboard,
  IconJobs,
  IconCompanies,
  IconProfile,
  IconAdmin,
  IconSignOut,
} from '../icons';

const nav = [
  { href: '/', label: 'Dashboard', icon: IconDashboard },
  { href: '/jobs', label: 'Jobs', icon: IconJobs },
  { href: '/companies', label: 'Companies', icon: IconCompanies },
  { href: '/profile', label: 'Profile', icon: IconProfile },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const navItems =
    user?.role === 'ADMIN'
      ? [...nav, { href: '/admin/users', label: 'Admin', icon: IconAdmin }]
      : nav;

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    logout();
    router.replace('/login');
  };

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 sm:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-60 flex-col border-r border-line bg-paper transition-transform duration-200',
          'sm:static sm:translate-x-0',
          isOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <LogoMark className="h-5 w-5 text-accent" />
        <span className="font-display text-[15px] font-semibold tracking-tight">Job Tracker</span>
        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent-2 shadow-[0_0_6px_var(--accent-2)]" aria-hidden="true" />
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn(
                'relative flex items-center gap-3 rounded-md py-2 pl-3.5 pr-3 font-mono text-[13px] font-medium uppercase tracking-wide transition-colors',
                active
                  ? 'bg-accent-soft text-accent-ink'
                  : 'text-muted hover:bg-paper-raised hover:text-ink',
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true" />
              )}
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line p-3">
        <div className="mb-2 flex items-center gap-3 rounded-md px-3 py-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent-ink">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user?.name}</p>
            <p className="truncate text-xs text-muted">{user?.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 font-mono text-[13px] uppercase tracking-wide text-muted transition-colors hover:bg-paper-raised hover:text-ink"
        >
          <IconSignOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
      </aside>
    </>
  );
}
