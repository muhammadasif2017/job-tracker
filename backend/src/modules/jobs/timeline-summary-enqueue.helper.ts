import { Logger } from 'nestjs-pino';
import { TimelineSummaryService } from '../timeline-summary/timeline-summary.service.js';

/**
 * Timeline-summary regeneration is best-effort — a queue or model hiccup
 * must never fail the job mutation that triggered it.
 *
 * Shared by `JobsService` (create, update) and `JobGhostingService`
 * (markGhosted) so the three of them cannot drift into different
 * failure contracts.
 */
export async function bestEffortEnqueueTimelineSummary(
  timelineSummary: TimelineSummaryService,
  logger: Logger,
  jobId: string,
): Promise<void> {
  try {
    await timelineSummary.enqueue(jobId);
  } catch (err: unknown) {
    logger.warn('Timeline summary enqueue failed', { jobId, err });
  }
}
