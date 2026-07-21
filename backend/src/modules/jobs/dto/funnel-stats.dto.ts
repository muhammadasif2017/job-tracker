import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, JobSource } from '@prisma/client';
import { FUNNEL_STAGES, DROPOFF_STAGES } from '../jobs.constants.js';

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
