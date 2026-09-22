import type { PrismaService } from '../prisma/prisma.service.js';
import { safeTimeZone } from './timezone.helper.js';

/**
 * The one read of `User.timezone` for request-time date logic (jobs'
 * `appliedAt` stamping, stats boundaries, interview-round notes). Read per
 * request rather than off the JWT, so a zone changed in the profile applies
 * on the very next request.
 *
 * `timeZone` is always usable by Intl: a missing row or empty column is the
 * column default, UTC. `invalidStoredZone` is the raw value only when a zone
 * was stored but Intl rejects it (a hand-edited row) — callers that should
 * surface that can log it.
 */
export async function findUserTimeZone(
  prisma: { user: Pick<PrismaService['user'], 'findUnique'> },
  userId: string,
): Promise<{ timeZone: string; invalidStoredZone: string | null }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  const stored = user?.timezone || null;
  const timeZone = safeTimeZone(stored);
  return {
    timeZone,
    invalidStoredZone: stored && timeZone !== stored ? stored : null,
  };
}
