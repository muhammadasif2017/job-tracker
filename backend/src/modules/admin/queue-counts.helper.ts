import type { Queue } from 'bullmq';
import { COUNTED_STATES } from './admin-queues.constants.js';

/** One queue's job counts, by the states the admin page and metrics show. */
export type QueueCounts = Record<(typeof COUNTED_STATES)[number], number>;

/**
 * Reads one queue's job counts. `AdminQueuesService` (the admin page) and
 * `QueueMetricsService` (Prometheus, ADR-052) both call this, so the two can
 * never disagree about the same queue.
 *
 * Throws when Redis fails. It cannot hang: the queues' connection sets
 * `commandTimeout` (`queueConnection`, ADR-046). Each caller decides what an
 * unreachable queue means for its own output.
 */
export async function readQueueCounts(queue: Queue): Promise<QueueCounts> {
  const counts = await queue.getJobCounts(...COUNTED_STATES);
  return Object.fromEntries(
    COUNTED_STATES.map((state) => [state, counts[state] ?? 0]),
  ) as QueueCounts;
}
