import { ApiProperty } from '@nestjs/swagger';

export class QueueCountsDto {
  @ApiProperty({ example: 3 })
  waiting: number;

  @ApiProperty({ example: 1 })
  active: number;

  @ApiProperty({ example: 0 })
  delayed: number;

  @ApiProperty({ example: 2 })
  failed: number;

  @ApiProperty({ example: 118 })
  completed: number;
}

export class QueueSnapshotDto {
  @ApiProperty({ example: 'company-target-enrichment' })
  name: string;

  @ApiProperty({
    description:
      'False when BullMQ could not be reached (Redis outage). The counts are null in that case; the database half of the response is still accurate.',
    example: true,
  })
  available: boolean;

  @ApiProperty({
    type: () => QueueCountsDto,
    nullable: true,
    description: 'Null when `available` is false.',
  })
  counts: QueueCountsDto | null;
}

export class CompanyStatusBucketDto {
  @ApiProperty({
    nullable: true,
    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
    description:
      'The raw Company.status value. Null is a legitimate resting state — CSV-imported companies are never enqueued — not a failure.',
    example: 'COMPLETED',
  })
  status: string | null;

  @ApiProperty({
    description:
      'Display label for the bucket. The null bucket is labelled "Never triggered".',
    example: 'Completed',
  })
  label: string;

  @ApiProperty({ example: 42 })
  count: number;
}

export class QueueObservabilityDto {
  @ApiProperty({ type: () => QueueSnapshotDto, isArray: true })
  queues: QueueSnapshotDto[];

  @ApiProperty({
    type: () => CompanyStatusBucketDto,
    isArray: true,
    description: 'Global company enrichment status counts, not user-scoped.',
  })
  companyStatuses: CompanyStatusBucketDto[];

  @ApiProperty({
    nullable: true,
    example: 0,
    description:
      'Companies stuck at status PENDING with no matching enrichment job in Redis: DB PENDING count minus (waiting + active + delayed), floored at 0. These rows show "Queued…" forever and the CAS in triggerEnrichment rejects a retry with 409, so no user can recover them from the UI. Null when the enrichment queue is unavailable, because the subtraction would then report every legitimately queued row as stranded.',
  })
  strandedPending: number | null;
}
