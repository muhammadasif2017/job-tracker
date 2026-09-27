import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

/**
 * Joins class names, letting later Tailwind classes override conflicting
 * earlier ones.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A real instant as "Mar 5, 2026" in the viewer's zone. Not for civil dates;
 * see `formatCivilDate`.
 */
export function formatDate(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy');
}

/**
 * For *civil dates* only — values stored as UTC midnight standing in for a
 * calendar day, with no real time-of-day component. `Job.appliedAt` and the
 * trend buckets' `periodStart` are the two (ADR-034). Reads UTC getters, via
 * a local Date built from those components, so the stored day is displayed
 * verbatim instead of being shifted for viewers west of UTC.
 *
 * NOT for `nextInterviewAt` or `InterviewRound.scheduledAt`: those are real
 * instants — an interview happens at a time, the attention list filters them
 * on a 48-hour window, and reminder emails schedule off them. Format those
 * with `formatDate`/`formatDateTime`, which read local getters, or a viewer
 * east of UTC sees an evening interview on the wrong day.
 */
export function formatCivilDate(date: string | Date) {
  const d = new Date(date);
  return format(
    new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    'MMM d, yyyy',
  );
}

/**
 * Rewrites ISO dates (`2026-09-27`) inside free text as `Sep 27, 2026`. The
 * LLM timeline summaries quote dates in ISO form, which reads like a database
 * dump next to every other date in the app. The model sometimes joins the
 * parts with a non-breaking or other Unicode hyphen, so those count too.
 * Strings that are not a real calendar date are left alone.
 */
export function humanizeIsoDates(text: string) {
  return text.replace(
    /\b(\d{4})[-‐-–](\d{2})[-‐-–](\d{2})\b/g,
    (match, y, m, d) => {
      const date = new Date(Date.UTC(+y, +m - 1, +d));
      return date.getUTCMonth() === +m - 1 && date.getUTCDate() === +d
        ? formatCivilDate(date)
        : match;
    },
  );
}

/**
 * The value a <input type="date"> wants for a civil date: its own encoding,
 * which is the first 10 characters. Kept next to the formatter so the two
 * can't drift on which getters they read.
 */
export function toDateInputValue(date: string | Date): string {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

/**
 * Today on the *viewer's* calendar, as a date-input value. `toISOString()`
 * would give UTC's today — a viewer in UTC+5 filling the form before 05:00
 * local would prefill yesterday.
 */
export function todayInputValue(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd');
}

/** A real instant relative to now, e.g. "3 days ago". */
export function formatRelative(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

/** A real instant as "Mar 5, 2026 2:30 PM" in the viewer's zone. */
export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy h:mm a');
}
