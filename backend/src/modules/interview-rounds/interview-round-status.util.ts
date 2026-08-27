import { InterviewOutcome } from '@prisma/client';

// Single source of truth for the derived-status values — the type is
// derived from this array (not hand-duplicated) so the Swagger enum in
// InterviewRoundResponseDto can import the same runtime list instead of
// re-listing the values itself.
export const INTERVIEW_ROUND_DERIVED_STATUSES = [
  'SCHEDULED',
  'AWAITING_RESPONSE',
  'POSSIBLY_GHOSTED',
  'PASSED',
  'FAILED',
  'CANCELLED',
] as const;

export type InterviewRoundDerivedStatus =
  (typeof INTERVIEW_ROUND_DERIVED_STATUSES)[number];

export const GHOST_THRESHOLD_DAYS = 7;

// Splits the PENDING outcome (currently the only bucket for "not yet
// resolved") into three UI-facing states, purely from scheduledAt vs now —
// no new stored state, same "computed from existing fields" approach as
// attention.helper.ts's STALE_INTERVIEWING/STALE_APPLIED heuristics.
// A resolved outcome (PASSED/FAILED/CANCELLED) passes through unchanged.
export function deriveInterviewRoundStatus(
  outcome: InterviewOutcome,
  scheduledAt: Date,
  now: Date = new Date(),
): InterviewRoundDerivedStatus {
  if (outcome !== InterviewOutcome.PENDING) return outcome;

  const ghostThreshold = new Date(
    now.getTime() - GHOST_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
  );
  if (scheduledAt < ghostThreshold) return 'POSSIBLY_GHOSTED';
  if (scheduledAt < now) return 'AWAITING_RESPONSE';
  return 'SCHEDULED';
}
