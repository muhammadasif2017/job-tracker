'use client';

import Link from 'next/link';
import { CalendarClock, Clock, MailQuestion } from 'lucide-react';
import { Skeleton, LoadingStatus } from '../ui/skeleton';
import { formatRelative } from '../../lib/utils';
import { useAttentionQuery } from '../../features/dashboard/hooks';
import type { AttentionType } from '../../types';

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
  UPCOMING_INTERVIEW: 'text-accent-2',
  STALE_INTERVIEWING: 'text-accent',
  STALE_APPLIED: 'text-muted-2',
};

export function AttentionCard() {
  const { data: items, isLoading } = useAttentionQuery();

  return (
    <div className="rounded-md border border-line bg-paper p-5">
      <h2 className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">
        Needs Attention
      </h2>
      {isLoading ? (
        <LoadingStatus label="Loading" className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </LoadingStatus>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-muted-2">
          All caught up — nothing needs action right now.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const Icon = ICONS[item.type];
            return (
              <li key={item.job.id}>
                <Link
                  href={`/jobs/${item.job.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-paper-raised"
                >
                  <Icon
                    className={`h-4 w-4 shrink-0 ${ICON_COLORS[item.type]}`}
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {item.job.company}{' '}
                      <span className="font-normal text-muted">
                        — {item.job.position}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted">
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
