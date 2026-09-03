// Wall-clock (calendar) helpers for per-user timezones, built on Intl rather
// than a date library — the backend has no timezone dependency and adding
// one for this is not worth the weight. Same Intl-based approach
// NotificationsScheduler already uses to decide a user's local digest hour.
//
// The core trick: a *civil* date (a calendar day with no zone attached) is
// encoded as a `Date` whose UTC fields hold the local fields — UTC midnight
// standing in for "that day". Day/week/month arithmetic is then plain UTC
// arithmetic with no DST discontinuity to trip over.
//
// `Job.appliedAt` is stored in exactly this encoding (see ADR-034), so these
// helpers are used to decide *which* civil day a real instant falls on — at
// write time, and when placing a boundary like "the 1st of this month". They
// are never applied to a value already read out of `appliedAt`: that value is
// civil already, and projecting it into a zone a second time would shift it.

const CIVIL_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

// A timezone can be anything the DB holds — the column is validated on write
// (IsIanaTimezone) but a hand-edited row would otherwise make `Intl` throw
// inside a request and 500 it. Fall back to UTC, which is what the column
// defaults to anyway.
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
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    ...CIVIL_FORMAT_OPTIONS,
    timeZone,
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day') };
}

// The local calendar day containing `instant`, as a civil date. This is the
// canonical way to turn "now" (or any real timestamp) into the value that
// gets stored in `Job.appliedAt`.
export function localCivilDay(instant: Date, timeZone: string): Date {
  const { year, month, day } = civilPartsIn(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, day));
}

// The 1st of the user's current local month, as a civil date — the lower
// bound for "applications this month". The zone decides *which* month is
// current (a user in UTC+5 rolls over five hours before a UTC server does);
// the bound itself is civil, because the column it's compared against is.
export function startOfCivilMonth(instant: Date, timeZone: string): Date {
  const { year, month } = civilPartsIn(instant, timeZone);
  return new Date(Date.UTC(year, month - 1, 1));
}

// `days` before the local calendar day containing `instant`, as a civil
// date. Backs the rolling 30d/90d stats ranges: the bound has to be civil
// too, or it carries a time-of-day the column never has and the boundary day
// is silently half-excluded. Plain UTC arithmetic — civil dates are already
// UTC-midnight, so subtracting whole days can't land mid-day across a DST
// change.
export function civilDaysAgo(
  instant: Date,
  timeZone: string,
  days: number,
): Date {
  return new Date(
    localCivilDay(instant, timeZone).getTime() - days * 86_400_000,
  );
}
