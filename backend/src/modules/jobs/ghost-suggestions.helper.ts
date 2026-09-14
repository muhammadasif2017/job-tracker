import { PrismaService } from '../../prisma/prisma.service.js';
import { JobStatus } from '@prisma/client';

// "Looks ghosted" suggestions (docs/specs/response-insights.md): applications
// with no activity for GHOST_AFTER_DAYS that the user may want to mark GHOSTED.
// Suggest-only — nothing here changes a job's status.
//
// Deliberately separate from getAttentionItems: the digest email reads that
// helper, and ghost suggestions must neither reach email nor disturb the
// STALE_* digest dedup.

export const GHOST_AFTER_DAYS = 14;

// Unlike the attention buckets this list also backs the per-job badge in the
// jobs list and kanban views, so it has to cover every silent application, not
// just the top of a call-to-action list. With a near-zero reply rate that can
// be a lot of jobs — the cap only bounds a pathological account.
export const MAX_GHOST_SUGGESTIONS = 200;

export async function getGhostSuggestions(
  prisma: PrismaService,
  userId: string,
) {
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - GHOST_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );

  const jobs = await prisma.job.findMany({
    where: {
      userId,
      status: { in: [JobStatus.APPLIED, JobStatus.INTERVIEWING] },
      // Cheap indexed pre-filter, and the guard for a job with no events.
      appliedAt: { lt: cutoff },
      // Any event counts as activity, including INTERVIEW_ROUND_ADDED.
      events: { none: { createdAt: { gt: cutoff } } },
      AND: [
        // A dismissal ("HR said wait") restarts the 14-day clock.
        {
          OR: [
            { ghostSuggestionDismissedAt: null },
            { ghostSuggestionDismissedAt: { lte: cutoff } },
          ],
        },
        // A scheduled interview is not silence, however old the last event.
        { OR: [{ nextInterviewAt: null }, { nextInterviewAt: { lt: now } }] },
      ],
    },
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
