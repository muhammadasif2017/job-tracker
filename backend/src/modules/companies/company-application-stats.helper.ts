import { JobStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  REPLIED_FILTER,
  SENT_APPLICATION_FILTER,
  toPercent,
} from '../jobs/jobs.constants.js';
import { buildSilentJobWhere } from '../jobs/ghost-suggestions.helper.js';

export interface CompanyApplicationStats {
  applied: number;
  replied: number;
  ghosted: number;
  replyRate: number;
  lastAppliedAt: Date | null;
}

export const EMPTY_APPLICATION_STATS: CompanyApplicationStats = {
  applied: 0,
  replied: 0,
  ghosted: 0,
  replyRate: 0,
  lastAppliedAt: null,
};

// Per-company application history (docs/specs/company-reply-history.md).
// Three grouped queries regardless of how many companies are asked for, so
// the companies list stays O(1) queries per page.
//
// "Replied" and "ghosted" can overlap: a job that reached INTERVIEWING and
// then went silent got a reply *and* was ghosted.
export async function getCompanyApplicationStats(
  prisma: PrismaService,
  userId: string,
  companyIds: string[],
): Promise<Map<string, CompanyApplicationStats>> {
  const stats = new Map<string, CompanyApplicationStats>();
  if (companyIds.length === 0) return stats;

  const scope = { userId, companyId: { in: companyIds } };
  const [sent, replied, ghosted] = await Promise.all([
    prisma.job.groupBy({
      by: ['companyId'],
      where: { ...scope, ...SENT_APPLICATION_FILTER },
      _count: { _all: true },
      _max: { appliedAt: true },
    }),
    prisma.job.groupBy({
      by: ['companyId'],
      where: { ...scope, ...SENT_APPLICATION_FILTER, ...REPLIED_FILTER },
      _count: { _all: true },
    }),
    // Silent jobs are APPLIED/INTERVIEWING, so WISHLIST is excluded by both
    // branches without spreading SENT_APPLICATION_FILTER (whose `status` key
    // would collide with the silent predicate's).
    prisma.job.groupBy({
      by: ['companyId'],
      where: {
        ...scope,
        OR: [
          { status: JobStatus.GHOSTED },
          buildSilentJobWhere(userId, new Date()),
        ],
      },
      _count: { _all: true },
    }),
  ]);

  for (const id of companyIds) stats.set(id, { ...EMPTY_APPLICATION_STATS });

  const entry = (companyId: string | null) =>
    companyId ? stats.get(companyId) : undefined;
  for (const row of sent) {
    const e = entry(row.companyId);
    if (!e) continue;
    e.applied = row._count._all;
    e.lastAppliedAt = row._max.appliedAt;
  }
  for (const row of replied) {
    const e = entry(row.companyId);
    if (e) e.replied = row._count._all;
  }
  for (const row of ghosted) {
    const e = entry(row.companyId);
    if (e) e.ghosted = row._count._all;
  }
  for (const e of stats.values()) e.replyRate = toPercent(e.replied, e.applied);

  return stats;
}
