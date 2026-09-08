import { EnrichmentStatus } from '@prisma/client';

/**
 * Passed explicitly to `getJobCounts`. The no-arg form's return shape has
 * changed between BullMQ majors, so naming the states keeps the response
 * stable across an upgrade.
 */
export const COUNTED_STATES = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
] as const;

export const STATUS_LABELS: Record<EnrichmentStatus, string> = {
  [EnrichmentStatus.PENDING]: 'Queued',
  [EnrichmentStatus.PROCESSING]: 'Processing',
  [EnrichmentStatus.COMPLETED]: 'Completed',
  [EnrichmentStatus.FAILED]: 'Failed',
};

/**
 * `null` is the resting state for a company that was never enqueued — the CSV
 * importer deliberately does not queue enrichment. Labelling it as a failure
 * would report dozens of perfectly normal rows as broken.
 */
export const NEVER_TRIGGERED_LABEL = 'Never triggered';

/**
 * The order buckets are rendered in, with `null` last so the resting state
 * does not lead the list.
 */
export const STATUS_ORDER: (EnrichmentStatus | null)[] = [
  EnrichmentStatus.PENDING,
  EnrichmentStatus.PROCESSING,
  EnrichmentStatus.COMPLETED,
  EnrichmentStatus.FAILED,
  null,
];
