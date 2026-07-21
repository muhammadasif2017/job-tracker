import { JobStatus } from '@prisma/client';

export const FUNNEL_STAGES = [
  JobStatus.WISHLIST,
  JobStatus.APPLIED,
  JobStatus.INTERVIEWING,
  JobStatus.OFFER,
] as const;

export const DROPOFF_STAGES = [JobStatus.REJECTED, JobStatus.GHOSTED] as const;

// Compile-time guard: every JobStatus must appear in FUNNEL_STAGES or
// DROPOFF_STAGES. If this fails to compile, a newly added JobStatus is
// missing from one of the two arrays above — the type error names it.
type UncoveredStages = Exclude<
  JobStatus,
  (typeof FUNNEL_STAGES)[number] | (typeof DROPOFF_STAGES)[number]
>;
const _allStagesCovered: UncoveredStages extends never
  ? true
  : [uncovered: UncoveredStages] = true;
void _allStagesCovered;

export const RESPONDED_STATUSES = [
  JobStatus.INTERVIEWING,
  JobStatus.OFFER,
  JobStatus.REJECTED,
] as const;

export function toPercent(numerator: number, denominator: number): number {
  return denominator > 0
    ? Math.round((numerator / denominator) * 1000) / 10
    : 0;
}
