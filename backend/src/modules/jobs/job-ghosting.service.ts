import { Injectable, NotFoundException } from '@nestjs/common';
import { JobStatus, JobEventType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { TimelineSummaryService } from '../timeline-summary/timeline-summary.service.js';
import { buildGhostSuggestionWhere } from './ghost-suggestions.helper.js';
import { bestEffortEnqueueTimelineSummary } from './timeline-summary-enqueue.helper.js';
import { appLogger } from '../../infrastructure/error-tracking/app-logger.helper.js';

/**
 * The ghost-suggestion actions: bulk "mark all ghosted" and the per-job
 * dismissal. Both are scoped by userId, so another user's job is
 * indistinguishable from one that does not exist — 404 for both, never 403.
 *
 * `JobsService` delegates to this so the controller's routes keep their
 * existing shape.
 */
@Injectable()
export class JobGhostingService {
  private readonly logger = appLogger(JobGhostingService);

  constructor(
    private prisma: PrismaService,
    private timelineSummary: TimelineSummaryService,
  ) {}

  /**
   * The bulk "mark all ghosted" action.
   *
   * The ids are what the user saw on the card, which may be stale by the
   * time they confirm — so each is re-checked against the live rule, scoped
   * by userId so another user's id never matches, and anything that got
   * activity or was dismissed in between is skipped.
   *
   * One statement per status the ghost rule allows, each carrying that
   * status and the live eligibility rule in its WHERE — so eligibility and
   * the compare-and-swap are one atomic step and every moved row's previous
   * status is known — then one statement for all the events, all in one
   * transaction. Going through `update` per job cost several round trips
   * each, for up to `MAX_GHOST_SUGGESTIONS` jobs per request. Nothing else `update` does applies here: no job leaves WISHLIST
   * and no company label changes. If a new side effect is added to
   * `update`'s status-change path, add it here too.
   */
  async markGhosted(userId: string, jobIds: string[]) {
    const ghostWhere = buildGhostSuggestionWhere(userId, new Date());
    const ids = [...new Set(jobIds)];

    const moved = await this.prisma.$transaction(async (tx) => {
      const rows: { id: string; fromStatus: JobStatus }[] = [];
      for (const fromStatus of ghostWhere.status.in) {
        const updated = await tx.job.updateManyAndReturn({
          where: { ...ghostWhere, id: { in: ids }, status: fromStatus },
          data: { status: JobStatus.GHOSTED },
          select: { id: true },
        });
        rows.push(...updated.map(({ id }) => ({ id, fromStatus })));
      }
      if (rows.length > 0) {
        await tx.jobEvent.createMany({
          data: rows.map(({ id, fromStatus }) => ({
            jobId: id,
            type: JobEventType.STATUS_CHANGE,
            fromStatus,
            toStatus: JobStatus.GHOSTED,
          })),
        });
      }
      return rows;
    });

    await Promise.all(
      moved.map(({ id }) =>
        bestEffortEnqueueTimelineSummary(this.timelineSummary, this.logger, id),
      ),
    );
    return { updated: moved.length };
  }

  /**
   * Quiets the ghost suggestion for one job — "HR said wait". A scoped
   * single statement, so no separate ownership read can race the write.
   */
  async dismissGhostSuggestion(userId: string, jobId: string) {
    // Scoped updateMany so another user's job is indistinguishable from a
    // missing one (404 for both), without a separate ownership SELECT.
    const { count } = await this.prisma.job.updateMany({
      where: { id: jobId, userId },
      data: { ghostSuggestionDismissedAt: new Date() },
    });
    if (count === 0) throw new NotFoundException('Job not found');
    return { message: 'Suggestion dismissed' };
  }
}
