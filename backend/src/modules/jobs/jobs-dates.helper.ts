import { PrismaService } from '../../prisma/prisma.service.js';
import { localCivilDay } from '../../common/timezone.helper.js';
import { findUserTimeZone } from '../../common/user-timezone.js';

/**
 * The civil date a client named. A date-only string already parses to UTC
 * midnight; a full ISO datetime, which the DTO's validator also accepts,
 * is floored to the UTC day it names rather than smuggling a time of day
 * into the column.
 */
export function civilDateFromInput(value: string): Date {
  const parsed = new Date(value);
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
    ),
  );
}

/**
 * The civil date we infer — the user's own today, not the server's. A
 * UTC+5 user applying at 02:00 local is on the next calendar day from a
 * UTC server's point of view, and the date they see in the list must be
 * the one they would write down.
 */
export async function todayFor(
  prisma: PrismaService,
  userId: string,
): Promise<Date> {
  const { timeZone } = await findUserTimeZone(prisma, userId);
  return localCivilDay(new Date(), timeZone);
}
