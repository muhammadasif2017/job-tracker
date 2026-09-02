import { PrismaService } from '../../prisma/prisma.service.js';
import { JobStatus } from '@prisma/client';
import { ATTENTION_TYPES } from './dto/attention-item.dto.js';

// "Needs attention" heuristics — computed from existing fields, no stored state:
// interviews within 48h, INTERVIEWING jobs with no event for 5 days, and
// APPLIED jobs with no movement for 7 days.

// Per-bucket cap. This backs a dashboard call-to-action list, not a report —
// past a few dozen entries it stops being actionable, and every row is a
// fully-hydrated Job. Each bucket is ordered by urgency first, so a cap drops
// the least urgent rows. Applied per bucket, before the cross-bucket dedup
// below, so the returned count can be lower than 3 × the cap.
const MAX_ITEMS_PER_RULE = 50;

export async function getAttentionItems(prisma: PrismaService, userId: string) {
  const [UPCOMING_INTERVIEW, STALE_INTERVIEWING, STALE_APPLIED] =
    ATTENTION_TYPES;

  const now = new Date();
  const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [upcoming, staleInterviewing, staleApplied] = await Promise.all([
    prisma.job.findMany({
      where: { userId, nextInterviewAt: { gte: now, lte: in48h } },
      orderBy: { nextInterviewAt: 'asc' },
      take: MAX_ITEMS_PER_RULE,
    }),
    prisma.job.findMany({
      where: {
        userId,
        status: JobStatus.INTERVIEWING,
        events: { none: { createdAt: { gt: fiveDaysAgo } } },
      },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'asc' },
      take: MAX_ITEMS_PER_RULE,
    }),
    // "No movement for 7 days" means no *activity* for 7 days, not "applied
    // more than 7 days ago" — same event-recency test STALE_INTERVIEWING
    // uses above. Without the events clause a job you followed up on
    // yesterday still nagged you as stalled, and (with appliedAt now
    // re-stamped on the WISHLIST -> APPLIED transition) a long-wishlisted
    // job would have been flagged stale the moment it was applied to.
    // `appliedAt` is kept as a cheap indexed pre-filter and as the guard for
    // the degenerate no-events-at-all row.
    prisma.job.findMany({
      where: {
        userId,
        status: JobStatus.APPLIED,
        appliedAt: { lt: sevenDaysAgo },
        events: { none: { createdAt: { gt: sevenDaysAgo } } },
      },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { appliedAt: 'asc' },
      take: MAX_ITEMS_PER_RULE,
    }),
  ]);

  const items = [
    ...upcoming.map((job) => ({
      type: UPCOMING_INTERVIEW,
      since: job.nextInterviewAt!,
      job,
    })),
    ...staleInterviewing.map(({ events, ...job }) => ({
      type: STALE_INTERVIEWING,
      since: events[0]?.createdAt ?? job.updatedAt,
      job,
    })),
    // `since` is "stalled since" — the last thing that happened, falling back
    // to the application date for a job with no events at all. It stays fixed
    // while the job remains stale (any new event un-stales it), which is the
    // invariant the digest dedup in NotificationsProcessor relies on.
    ...staleApplied.map(({ events, ...job }) => ({
      type: STALE_APPLIED,
      since: events[0]?.createdAt ?? job.appliedAt,
      job,
    })),
  ];

  // A job can match several rules — keep only its highest-priority reason
  // (array order above is the priority order)
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.job.id)) return false;
    seen.add(item.job.id);
    return true;
  });
}
