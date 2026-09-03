import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy');
}

// For *civil dates* only — values stored as UTC midnight standing in for a
// calendar day, with no real time-of-day component. `Job.appliedAt` and the
// trend buckets' `periodStart` are the two (ADR-034). Reads UTC getters, via
// a local Date built from those components, so the stored day is displayed
// verbatim instead of being shifted for viewers west of UTC.
//
// NOT for `nextInterviewAt` or `InterviewRound.scheduledAt`: those are real
// instants — an interview happens at a time, the attention list filters them
// on a 48-hour window, and reminder emails schedule off them. Format those
// with `formatDate`/`formatDateTime`, which read local getters, or a viewer
// east of UTC sees an evening interview on the wrong day.
export function formatCivilDate(date: string | Date) {
  const d = new Date(date);
  return format(
    new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    'MMM d, yyyy',
  );
}

// The value a <input type="date"> wants for a civil date: its own encoding,
// which is the first 10 characters. Kept next to the formatter so the two
// can't drift on which getters they read.
export function toDateInputValue(date: string | Date): string {
  const d = new Date(date);
  return d.toISOString().slice(0, 10);
}

// Today on the *viewer's* calendar, as a date-input value. `toISOString()`
// would give UTC's today — a viewer in UTC+5 filling the form before 05:00
// local would prefill yesterday.
export function todayInputValue(now: Date = new Date()): string {
  return format(now, 'yyyy-MM-dd');
}

export function formatRelative(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy h:mm a');
}
