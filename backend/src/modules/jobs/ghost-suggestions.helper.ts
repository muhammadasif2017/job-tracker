import { PrismaService } from '../../prisma/prisma.service.js';
import { JobStatus, Prisma } from '@prisma/client';

// "Looks ghosted" suggestions (docs/specs/response-insights.md): applications
// with no activity for GHOST_AFTER_DAYS that the user may want to mark GHOSTED.
// Suggest-only — nothing here changes a job's status.
//
// Deliberately separate from getAttentionItems: the digest email reads that
// helper, and ghost suggestions must neither reach email nor disturb the
// STALE_* digest dedup.

/** Days of silence before an open application is suggested as ghosted. */
export const GHOST_AFTER_DAYS = 14;

/**
 * Upper bound on suggestions returned for one user.
 *
 * Unlike the attention buckets this list also backs the per-job badge in the
 * jobs list and kanban views, so it has to cover every silent application, not
 * just the top of a call-to-action list. With a near-zero reply rate that can
 * be a lot of jobs — the cap only bounds a pathological account.
 */
export const MAX_GHOST_SUGGESTIONS = 200;

/** The instant `GHOST_AFTER_DAYS` before `now`; activity after it breaks the silence. */
export function ghostCutoff(now: Date) {
  return new Date(now.getTime() - GHOST_AFTER_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * "Silent for GHOST_AFTER_DAYS": an open application with no activity since the
 * cutoff and no interview still ahead. Shared with the per-company ghosted
 * count (docs/specs/company-reply-history.md), which must not honor a
 * dismissal — dismissing means "stop suggesting", not "the company replied".
 */
export function buildSilentJobWhere(userId: string, now: Date) {
  const cutoff = ghostCutoff(now);
  return {
    userId,
    status: { in: [JobStatus.APPLIED, JobStatus.INTERVIEWING] },
    // Cheap indexed pre-filter, and the guard for a job with no events.
    appliedAt: { lt: cutoff },
    // Any event counts as activity, including INTERVIEW_ROUND_ADDED.
    events: { none: { createdAt: { gt: cutoff } } },
    // A scheduled interview is not silence, however old the last event.
    AND: [
      { OR: [{ nextInterviewAt: null }, { nextInterviewAt: { lt: now } }] },
    ],
  } satisfies Prisma.JobWhereInput;
}

/**
 * The suggestion rule itself, shared by the suggestions list and the dashboard
 * attention filter so the two can never disagree about which jobs look ghosted.
 */
export function buildGhostSuggestionWhere(userId: string, now: Date) {
  const silent = buildSilentJobWhere(userId, now);
  const cutoff = ghostCutoff(now);
  return {
    ...silent,
    AND: [
      // A dismissal ("HR said wait") restarts the 14-day clock.
      {
        OR: [
          { ghostSuggestionDismissedAt: null },
          { ghostSuggestionDismissedAt: { lte: cutoff } },
        ],
      },
      ...silent.AND,
    ],
  } satisfies Prisma.JobWhereInput;
}

/**
 * The user's ghost suggestions, oldest silence first, each with the date it
 * went silent. Capped at `MAX_GHOST_SUGGESTIONS`.
 */
export async function getGhostSuggestions(
  prisma: PrismaService,
  userId: string,
) {
  const jobs = await prisma.job.findMany({
    where: buildGhostSuggestionWhere(userId, new Date()),
    include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { appliedAt: 'asc' },
    take: MAX_GHOST_SUGGESTIONS,
  });

  return (
    jobs
      .map(({ events, ...job }) => {
        // "Silent since" — the last thing that happened: the latest event, the
        // last dismissal, or the application date, whichever is newest.
        const candidates = [
          job.appliedAt,
          events[0]?.createdAt,
          job.ghostSuggestionDismissedAt,
        ].filter((d): d is Date => d != null);
        const since = new Date(Math.max(...candidates.map((d) => d.getTime())));
        return { since, job };
      })
      // Oldest silence first — the most clearly dead application leads.
      .sort((a, b) => a.since.getTime() - b.since.getTime())
  );
}
