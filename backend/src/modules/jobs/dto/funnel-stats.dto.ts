import { ApiProperty } from '@nestjs/swagger';
import { JobStatus, ApplicationChannel, DiscoverySource } from '@prisma/client';
import { FUNNEL_STAGES, DROPOFF_STAGES } from '../jobs.constants.js';

export class FunnelStageDto {
  @ApiProperty({ enum: FUNNEL_STAGES, example: JobStatus.APPLIED })
  status: (typeof FUNNEL_STAGES)[number];

  @ApiProperty({
    example: 12,
    description: 'Distinct jobs that ever reached this stage',
  })
  reached: number;
}

export class DropoffStageDto {
  @ApiProperty({ enum: DROPOFF_STAGES, example: JobStatus.REJECTED })
  status: (typeof DROPOFF_STAGES)[number];

  @ApiProperty({ example: 8 })
  count: number;
}

export class SourceResponseRateDto {
  @ApiProperty({
    enum: [...Object.values(ApplicationChannel), 'UNSPECIFIED'],
    example: ApplicationChannel.LINKEDIN,
  })
  source: ApplicationChannel | 'UNSPECIFIED';

  @ApiProperty({ example: 20 })
  total: number;

  @ApiProperty({
    example: 45.2,
    description:
      'Percentage of applications sent through this channel that ever got a reply',
  })
  responseRate: number;
}

export class DiscoverySourceResponseRateDto {
  @ApiProperty({
    enum: [...Object.values(DiscoverySource), 'UNSPECIFIED'],
    example: DiscoverySource.ROZEE,
  })
  source: DiscoverySource | 'UNSPECIFIED';

  @ApiProperty({ example: 20 })
  total: number;

  @ApiProperty({
    example: 12.5,
    description:
      'Percentage of applications found through this source that ever got a reply',
  })
  responseRate: number;
}

export class ReplyTimingDto {
  @ApiProperty({
    example: 12,
    description:
      'Replies with a known date. Jobs added straight into a replied status have none and are excluded.',
  })
  repliedCount: number;

  @ApiProperty({
    example: 6.5,
    nullable: true,
    type: Number,
    description:
      'Median days from applying to the first reply; null when there are no dated replies',
  })
  medianDays: number | null;

  @ApiProperty({
    example: 16.7,
    description:
      'Share of dated replies that arrived after the 14-day "looks ghosted" cutoff',
  })
  repliedAfter14DaysPercent: number;
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

  @ApiProperty({
    type: () => SourceResponseRateDto,
    isArray: true,
    description:
      'Response rate by application channel (where the application was sent)',
  })
  responseRateBySource: SourceResponseRateDto[];

  @ApiProperty({
    type: () => DiscoverySourceResponseRateDto,
    isArray: true,
    description: 'Response rate by discovery source (where the job was found)',
  })
  responseRateByDiscoverySource: DiscoverySourceResponseRateDto[];

  @ApiProperty({ type: () => ReplyTimingDto })
  replyTiming: ReplyTimingDto;
}
