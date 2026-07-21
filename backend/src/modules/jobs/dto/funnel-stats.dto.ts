import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, JobSource } from '@prisma/client';

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

export class FunnelStageDto {
  @ApiProperty({ enum: FUNNEL_STAGES, example: JobStatus.APPLIED })
  status: (typeof FUNNEL_STAGES)[number];

  @ApiProperty({ example: 12, description: 'Distinct jobs that ever reached this stage' })
  reached: number;
}

export class DropoffStageDto {
  @ApiProperty({ enum: DROPOFF_STAGES, example: JobStatus.REJECTED })
  status: (typeof DROPOFF_STAGES)[number];

  @ApiProperty({ example: 8 })
  count: number;
}

export class SourceResponseRateDto {
  @ApiProperty({ enum: [...Object.values(JobSource), 'UNSPECIFIED'], example: JobSource.LINKEDIN })
  source: JobSource | 'UNSPECIFIED';

  @ApiProperty({ example: 20 })
  total: number;

  @ApiProperty({ example: 45.2, description: 'Percentage of applications from this source that got a response' })
  responseRate: number;
}

export class FunnelStatsDto {
  @ApiProperty({ type: () => FunnelStageDto, isArray: true })
  funnel: FunnelStageDto[];

  @ApiProperty({ type: () => DropoffStageDto, isArray: true })
  dropoff: DropoffStageDto[];

  @ApiProperty({
    example: { APPLIED: 4.5, INTERVIEWING: 6.2 },
    description:
      'Average days spent in each stage before moving on. Stage omitted if no job has moved past it yet.',
  })
  avgTimeInStageDays: Partial<Record<JobStatus, number>>;

  @ApiProperty({ type: () => SourceResponseRateDto, isArray: true })
  responseRateBySource: SourceResponseRateDto[];
}
