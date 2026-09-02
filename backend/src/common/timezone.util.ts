// Wall-clock (calendar) helpers for per-user timezones, built on Intl rather
// than a date library — the backend has no timezone dependency and adding
// one for this is not worth the weight. Same Intl-based approach
// NotificationsScheduler already uses to decide a user's local digest hour.
//
// The core trick: a *civil* date (a wall-clock instant with no zone attached)
// is encoded as a `Date` whose UTC fields hold the local fields. That makes
// day/week/month arithmetic plain UTC arithmetic — no DST discontinuity to
// trip over — and `zonedInstantFromCivil` converts back to the real instant
// when one is needed (e.g. a Prisma `gte` bound, which must be a true UTC
// point in time).

const CIVIL_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
};

// A timezone can be anything the DB holds — the column is validated on write
// (IsIanaTimezone) but a hand-edited row would otherwise make `Intl` throw
// inside a stats request and 500 the dashboard. Fall back to UTC, which is
// what the column defaults to anyway.
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

function civilPartsIn(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; ms: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...CIVIL_FORMAT_OPTIONS,
    timeZone,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = get('year');
  const month = get('month');
  const day = get('day');
  return {
    year,
    month,
    day,
    ms: Date.UTC(
      year,
      month - 1,
      day,
      get('hour'),
      get('minute'),
      get('second'),
    ),
  };
}

// The instant's wall clock in `timeZone`, encoded as UTC ms.
export function civilMsIn(instant: Date, timeZone: string): number {
  return civilPartsIn(instant, timeZone).ms;
}

// The local calendar day containing `instant`, as a civil date (UTC-midnight
// encoded). Bucketing keys off this so two instants land in the same bucket
// exactly when the user would call them the same day.
export function localCivilDay(instant: Date, timeZone: string): Date {
  const { year, month, day } = civilPartsIn(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

// Inverse of `civilMsIn`: the real UTC instant at which `timeZone`'s wall
// clock reads `civilMs`. Two passes because the offset itself depends on the
// instant — the first guess lands within an hour or so of the answer even
// across a DST change, and re-measuring the offset there converges.
// Ambiguous/skipped wall times (the DST fold) resolve to one of the two
// legal readings; nothing here depends on which.
export function zonedInstantFromCivil(civilMs: number, timeZone: string): Date {
  let guess = civilMs - (civilMsIn(new Date(civilMs), timeZone) - civilMs);
  guess = civilMs - (civilMsIn(new Date(guess), timeZone) - guess);
  return new Date(guess);
}

// Real UTC instant of midnight on the 1st of the user's current local month —
// the lower bound for "applications this month". Computed in the user's zone,
// not the server's: a user in UTC+5 rolls into a new month five hours before
// a UTC server does, and their dashboard should agree with their calendar.
export function startOfLocalMonth(instant: Date, timeZone: string): Date {
  const { year, month } = civilPartsIn(instant, timeZone);
  return zonedInstantFromCivil(Date.UTC(year, month - 1, 1), timeZone);
}
