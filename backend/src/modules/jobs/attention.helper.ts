import { PrismaService } from '../../prisma/prisma.service.js';
import { JobStatus } from '@prisma/client';
import { ATTENTION_TYPES } from './dto/attention-item.dto.js';

// "Needs attention" heuristics — computed from existing fields, no stored state:
// interviews within 48h, INTERVIEWING jobs with no event for 5 days, and
// APPLIED jobs with no movement for 7 days.
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
    }),
    prisma.job.findMany({
      where: {
        userId,
        status: JobStatus.INTERVIEWING,
        events: { none: { createdAt: { gt: fiveDaysAgo } } },
      },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      orderBy: { updatedAt: 'asc' },
    }),
    prisma.job.findMany({
      where: {
        userId,
        status: JobStatus.APPLIED,
        appliedAt: { lt: sevenDaysAgo },
      },
      orderBy: { appliedAt: 'asc' },
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
    ...staleApplied.map((job) => ({
      type: STALE_APPLIED,
      since: job.appliedAt,
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
