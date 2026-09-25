import { ApiProperty } from '@nestjs/swagger';

/** Job counts for one BullMQ queue, by state. */
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

/**
 * One queue on the admin queues page: its name, whether Redis answered, and
 * its counts.
 */
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

/** Number of companies in one enrichment status, across all users. */
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

/** One circuit breaker on the admin queues page (ADR-048). */
export class CircuitStatusDto {
  @ApiProperty({ example: 'Groq' })
  name: string;

  @ApiProperty({
    enum: ['closed', 'open', 'half-open'],
    description:
      'closed: calls pass through. open: calls fail fast without reaching the upstream. half-open: one trial call is in flight.',
    example: 'closed',
  })
  state: 'closed' | 'open' | 'half-open';

  @ApiProperty({
    nullable: true,
    example: null,
    description:
      'Milliseconds until an open circuit lets a trial call through. 0 means the cool-down has passed and the next call will be the trial. Null unless open.',
  })
  retryAfterMs: number | null;
}

/**
 * Response for the admin queues page: every queue, global company enrichment
 * status counts, and stranded PENDING rows.
 */
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

  @ApiProperty({
    type: () => CircuitStatusDto,
    isArray: true,
    description: 'Circuit breakers around upstream services, in this process.',
  })
  circuits: CircuitStatusDto[];
}
