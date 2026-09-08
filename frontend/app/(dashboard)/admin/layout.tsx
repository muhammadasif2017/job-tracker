'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../../lib/utils';

// Tenant administration (users) and system health (queues) are different jobs
// on different cadences — one is "who is on this install", the other is "is
// the background work moving". They shared a page until the queue panel grew
// its own detail; the sidebar still carries a single "Admin" entry, and these
// tabs do the second level of navigation.
const TABS = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/queues', label: 'Queues' },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-5">
      <nav aria-label="Admin sections" className="border-b border-line">
        <ul className="-mb-px flex gap-1">
          {TABS.map(({ href, label }) => {
            const active = pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-block border-b-2 px-3 py-2 font-mono text-[13px] font-medium uppercase tracking-wide transition-colors',
                    active
                      ? 'border-accent text-accent-ink'
                      : 'border-transparent text-muted hover:text-ink',
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {children}
    </div>
  );
}
