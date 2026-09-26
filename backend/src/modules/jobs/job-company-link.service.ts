import { Injectable } from '@nestjs/common';
import { CompanyCity } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { CompanyEnrichmentService } from '../companies/enrichment/company-enrichment.service.js';
import { companyNameMatch } from '../companies/company-name-match.helper.js';
import { logRedisFailure } from '../../infrastructure/redis/redis-errors.helper.js';
import { appLogger } from '../../infrastructure/error-tracking/app-logger.helper.js';

/**
 * Resolves the `Job.companyId` FK from the company label a user typed, and
 * queues enrichment for a company a job was just linked to.
 *
 * Split out of `JobsService`: the find-or-create race handling and the
 * enrichment contract are one concern, shared by create and update, and
 * neither is about job CRUD.
 */
@Injectable()
export class JobCompanyLinkService {
  private readonly logger = appLogger(JobCompanyLinkService);

  constructor(
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
  ) {}

  /**
   * Queues enrichment for a company a job was just linked to — by `create`,
   * or by an edit that re-resolved the label. One best-effort contract for
   * both: a queue hiccup never fails the mutation that triggered it.
   *
   * Editing a job's company label re-resolves the FK, and
   * `resolveCompanyId` auto-creates the row when no company of that name
   * exists yet. Without this call nothing ever queued a run for it, and
   * `findOne` renders a null status as PENDING — so correcting a typo'd
   * company name left the profile showing "Queued…" forever, with the job
   * page polling for a state that never changed.
   *
   * `enqueueIfStale`, not `enqueueEnrichment`: re-linking to a company that
   * is already enriched, running or failed must not re-burn search quota
   * (ADR-035).
   */
  async enqueueLinkedCompany(
    jobId: string,
    companyId: string | null,
  ): Promise<void> {
    if (!companyId) return;
    try {
      await this.companyEnrichment.enqueueIfStale(companyId);
    } catch (err: unknown) {
      // Best-effort — the job create or update stands.
      logRedisFailure(
        this.logger,
        err,
        { jobId, companyId },
        'Enrichment enqueue failed',
      );
    }
  }

  /**
   * Find-or-create for the `Job.companyId` FK, matching on the name the
   * user typed. Case-insensitive exact, no fuzzy matching
   * (docs/specs/target-companies.md, Assumption 6), and it never
   * overwrites an existing company's fields as a side effect of linking a
   * job to it.
   *
   * `matched` is true only for a pre-existing company — callers use it to
   * tell "linked to a company you already saved" from "this row was
   * auto-created". The loser of a create race counts as the latter, exactly
   * as a plain non-concurrent create would have.
   *
   * Concurrency is the database's job. The functional unique index on
   * `(userId, lower(name))` — see the `add_company_ci_unique` migration —
   * makes a case-variant duplicate an ordinary
   * unique violation, so a losing racer gets P2002 and the winner's row is
   * already committed and findable. This replaced a Serializable
   * transaction wrapped in an eight-attempt retry loop: the
   * case-insensitive `findFirst` had no index to match, so Serializable
   * predicate-locked the user's entire name range and two creates for
   * completely unrelated companies aborted each other — a standing tax on
   * exactly the bulk paths that matter, the browser extension and CSV
   * import (ADR-029).
   */
  async resolveCompanyId(
    userId: string,
    trimmedName: string,
    // `string | null` (not just `undefined`) because the DTO convention here
    // types clearable fields that way — see CLAUDE.md / ADR-022.
    location?: string | null,
  ): Promise<{
    company: { id: string; name: string } | null;
    matched: boolean;
  }> {
    if (!trimmedName) return { company: null, matched: false };

    const existing = await this.prisma.company.findFirst({
      where: companyNameMatch(userId, trimmedName),
      select: { id: true, name: true },
    });
    if (existing) return { company: existing, matched: true };

    try {
      const created = await this.prisma.company.create({
        // The job's location is seeded onto the auto-created row purely as an
        // enrichment anchor: LlmService.extract turns Company.location into a
        // disambiguation hint ("prefer content consistent with a company
        // operating in or near this location"), and without it a small
        // company's search results — which routinely mix in several unrelated
        // same-named businesses — give the model nothing to tell them apart.
        // Only ever set at creation, so it can't overwrite a location the
        // user has since corrected on an existing company.
        data: {
          userId,
          name: trimmedName,
          city: CompanyCity.OTHER,
          location: location?.trim() || undefined,
        },
        select: { id: true, name: true },
      });
      return { company: created, matched: false };
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code !== 'P2002') throw err;

      // Lost the race. The conflicting row is committed by definition — a
      // unique violation can't be raised against an uncommitted one — so
      // this re-fetch resolves it. A null here would mean the row was
      // deleted between the violation and this read, which no code path
      // does mid-request; rethrowing lets GlobalExceptionFilter map the
      // P2002 to a 409 rather than inventing a wrong answer.
      const raced = await this.prisma.company.findFirst({
        where: companyNameMatch(userId, trimmedName),
        select: { id: true, name: true },
      });
      if (!raced) throw err;
      return { company: raced, matched: false };
    }
  }
}
