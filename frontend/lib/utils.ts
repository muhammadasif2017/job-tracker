import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date) {
  return format(new Date(date), 'MMM d, yyyy');
}

// For date-only fields (appliedAt, scheduledAt, nextInterviewAt) that are
// stored as a UTC-midnight instant representing a calendar date with no
// real time-of-day component. formatDate() reads local getters and would
// shift the displayed day for users west of UTC — this reads UTC getters
// instead, via a local Date built from those UTC components (avoids
// pulling in date-fns-tz for one function).
export function formatDateOnly(date: string | Date) {
  const d = new Date(date);
  return format(
    new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
    'MMM d, yyyy',
  );
}

export function formatRelative(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}
