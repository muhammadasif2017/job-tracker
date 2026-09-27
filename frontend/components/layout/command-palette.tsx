'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as Dialog from '@radix-ui/react-dialog';
import {
  BarChart2,
  Briefcase,
  Building2,
  CornerDownLeft,
  Search,
  User,
  type LucideIcon,
} from 'lucide-react';
import { StatusBadge } from '../ui/badge';
import { useJobsQuery } from '../../features/jobs/hooks';
import { cn } from '../../lib/utils';
import { useDebounce } from '../../lib/use-debounce';
import type { JobStatus } from '../../types';

/** The app's pages, always offered and filtered by the typed text. */
const PAGES: { label: string; href: string; icon: LucideIcon }[] = [
  { label: 'Dashboard', href: '/', icon: BarChart2 },
  { label: 'Jobs', href: '/jobs', icon: Briefcase },
  { label: 'Companies', href: '/companies', icon: Building2 },
  { label: 'Profile', href: '/profile', icon: User },
];

/** One row in the palette: a page or a job. */
interface PaletteItem {
  id: string;
  href: string;
  label: string;
  hint?: string;
  icon?: LucideIcon;
  status?: JobStatus;
}

/**
 * Header search button plus a Ctrl/⌘+K palette that jumps to any page or job
 * without leaving the keyboard.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-muted-2 transition-colors hover:border-muted-2 hover:text-muted"
      >
        <Search className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Search</span>
        <kbd className="hidden rounded-sm border border-line bg-paper px-1.5 font-mono text-[10px] sm:inline">
          Ctrl K
        </kbd>
      </button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-[12vh] z-50 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-lg border border-line bg-paper shadow-2xl"
          >
            <Dialog.Title className="sr-only">Search</Dialog.Title>
            {/* Mounted only while open, so the job search runs only then and
                the typed text starts empty on every open. */}
            {open && <PaletteBody onNavigate={() => setOpen(false)} />}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** Props for `PaletteBody`. */
interface PaletteBodyProps {
  onNavigate: () => void;
}

/** Search box and keyboard-driven result list inside the palette. */
function PaletteBody({ onNavigate }: PaletteBodyProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const search = useDebounce(query.trim(), 200);
  const { data, isFetching } = useJobsQuery({
    page: 1,
    search,
    status: '',
    dateFrom: '',
    dateTo: '',
  });

  const needle = query.trim().toLowerCase();
  const items: PaletteItem[] = [
    ...PAGES.filter((p) => p.label.toLowerCase().includes(needle)).map((p) => ({
      id: `page-${p.href}`,
      ...p,
      hint: 'Page',
    })),
    ...(data?.data ?? []).map((job) => ({
      id: `job-${job.id}`,
      href: `/jobs/${job.id}`,
      label: `${job.company} — ${job.position}`,
      status: job.status,
    })),
  ];
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const go = (item: PaletteItem | undefined) => {
    if (!item) return;
    router.push(item.href);
    onNavigate();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % Math.max(items.length, 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(items[current]);
    }
  };

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-2" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={items[current]?.id}
          aria-label="Search pages and jobs"
          placeholder="Jump to a page or search your jobs…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted-2"
        />
        {isFetching && (
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-2">
            Searching
          </span>
        )}
      </div>
      <ul
        id="palette-results"
        role="listbox"
        aria-label="Results"
        className="max-h-[50vh] overflow-y-auto p-2"
      >
        {items.length === 0 && !isFetching && (
          <li className="px-3 py-6 text-center text-sm text-muted-2">
            Nothing matches “{query.trim()}”.
          </li>
        )}
        {items.map((item, i) => {
          const Icon = item.icon ?? Briefcase;
          return (
            <li
              key={item.id}
              id={item.id}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => setActive(i)}
              onClick={() => go(item)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm',
                i === current ? 'bg-accent-soft text-ink' : 'text-muted',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.status ? (
                <StatusBadge status={item.status} />
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-2">
                  {item.hint}
                </span>
              )}
              {i === current && (
                <CornerDownLeft
                  className="h-3.5 w-3.5 shrink-0 text-muted-2"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
