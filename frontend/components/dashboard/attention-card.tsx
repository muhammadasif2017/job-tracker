'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { CalendarClock, Clock, MailQuestion } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import { formatRelative } from '../../lib/utils';
import api from '../../lib/api';
import type { AttentionItem, AttentionType } from '../../types';

const MESSAGES: Record<AttentionType, (since: string) => string> = {
  UPCOMING_INTERVIEW: (since) => `Interview ${formatRelative(since)} — prepare`,
  STALE_INTERVIEWING: (since) =>
    `No activity since ${formatRelative(since)} — nudge the recruiter`,
  STALE_APPLIED: (since) =>
    `Applied ${formatRelative(since)} — follow up or mark ghosted`,
};

const ICONS: Record<AttentionType, typeof Clock> = {
  UPCOMING_INTERVIEW: CalendarClock,
  STALE_INTERVIEWING: Clock,
  STALE_APPLIED: MailQuestion,
};

const ICON_COLORS: Record<AttentionType, string> = {
  UPCOMING_INTERVIEW: 'text-violet-500',
  STALE_INTERVIEWING: 'text-amber-500',
  STALE_APPLIED: 'text-slate-400',
};

export function AttentionCard() {
  const { data: items, isLoading } = useQuery<AttentionItem[]>({
    queryKey: ['attention'],
    queryFn: () => api.get('/jobs/attention').then((r) => r.data),
  });

  return (
    <div className="rounded-xl border bg-white p-5 dark:bg-slate-900">
      <h2 className="mb-4 text-sm font-semibold">Needs Attention</h2>
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-slate-400">
          All caught up — nothing needs action right now.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map((item) => {
            const Icon = ICONS[item.type];
            return (
              <li key={item.job.id}>
                <Link
                  href={`/jobs/${item.job.id}`}
                  className="flex items-center gap-3 py-2.5 -mx-2 px-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${ICON_COLORS[item.type]}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {item.job.company}{' '}
                      <span className="font-normal text-slate-500">
                        — {item.job.position}
                      </span>
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {MESSAGES[item.type](item.since)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
