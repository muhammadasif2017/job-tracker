import { BadRequestException } from '@nestjs/common';
import { JobStatus } from '@prisma/client';
import { UpdateJobDto } from './dto/update-job.dto.js';

/**
 * The decisions `JobsService.update` makes before it writes anything, kept
 * separate from the writes themselves. All three are pure: they read the
 * submitted DTO and the row already fetched by `findOwned`, and touch no
 * database.
 */

/**
 * `Job.company` is a required, non-nullable column — unlike the optional
 * profile fields this repo's convention lets a client clear with an
 * explicit null, there is no "no company" state to unlink into.
 * `IsOptional()` (added by PartialType) lets null past DTO validation, so
 * this must be rejected explicitly rather than falling through to `.trim()`
 * on null.
 */
export function assertCompanyNotCleared(dto: UpdateJobDto): void {
  if (dto.company === null) {
    throw new BadRequestException(
      'company cannot be cleared — omit the field to leave it unchanged',
    );
  }
}

/**
 * Whether this edit actually changed the company label, as opposed to
 * resending it.
 *
 * JobForm always resends the pre-filled `company` label on every submit,
 * even when the user only touched an unrelated field — so
 * "dto.company !== undefined" alone can't mean "user edited it". If the
 * trimmed label still matches the current label and a companyId is already
 * linked, this is a no-op rather than a re-resolve: re-resolving a stale
 * label after the linked Company was renamed or merged elsewhere would
 * silently re-link to (or recreate) a different company, undoing that
 * rename/merge on an unrelated edit (ADR-030).
 */
export function companyLabelNeedsResolving(
  dto: UpdateJobDto,
  existing: { company: string; companyId: string | null },
): boolean {
  if (dto.company === undefined) return false;
  const matchesCurrentLabel =
    existing.companyId !== null &&
    dto.company.trim().toLowerCase() === existing.company.toLowerCase();
  return !matchesCurrentLabel;
}

/**
 * Whether leaving WISHLIST should re-stamp `appliedAt` to the user's today.
 *
 * `Job.appliedAt` is `@default(now())`, so a job saved to the wishlist in
 * June already carries June as its application date — and nothing used to
 * move it when the user actually applied. Every "applications sent" metric
 * reads that column (getStats.thisMonth, the trend buckets, the 30d/90d
 * range filters, the CSV "Applied Date", the default list sort), so
 * applying today to a long-wishlisted job was reported as an application
 * made months ago: absent from this month's count, plotted on the wrong
 * bar, and sorted to the bottom of the list.
 *
 * Leaving WISHLIST in any direction is the moment it becomes a real
 * application (the kanban board lets you drag straight to INTERVIEWING),
 * so it is stamped then — with the user's own today, since the column is a
 * civil date (ADR-034).
 *
 * The guard is "the client sent an appliedAt *different from the stored
 * one*", not merely "sent one at all". JobForm resends every field on every
 * submit, including the untouched pre-filled date, so an `!== undefined`
 * check meant the re-stamp fired on a kanban drag and silently didn't on
 * the exact same transition made through the edit form. A date the user
 * genuinely changed still wins.
 */
export function shouldRestampAppliedAt(args: {
  statusChanged: boolean;
  existingStatus: JobStatus;
  existingAppliedAt: Date;
  submittedAppliedAt: Date | undefined;
}): boolean {
  const leftWishlist =
    args.statusChanged && args.existingStatus === JobStatus.WISHLIST;
  const appliedAtEdited =
    args.submittedAppliedAt !== undefined &&
    args.submittedAppliedAt.getTime() !== args.existingAppliedAt.getTime();
  return leftWishlist && !appliedAtEdited;
}
