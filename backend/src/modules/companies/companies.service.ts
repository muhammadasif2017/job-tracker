import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EnrichmentStatus } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isTransactionWriteConflict } from '../../common/prisma-errors.js';
import { CreateCompanyDto } from './dto/create-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
import { CompanyQueryDto } from './dto/company-query.dto.js';
import type { MergeFieldOverridesDto } from './dto/merge-company.dto.js';
import {
  normalizeCompanyName,
  normalizeWebsiteUrl,
  similarityRatio,
} from '../../common/similarity.js';
import { CompanyEnrichmentService } from './enrichment/company-enrichment.service.js';
import {
  EMPTY_APPLICATION_STATS,
  getCompanyApplicationStats,
} from './company-application-stats.helper.js';
import { companyNameMatch } from './company-name-match.helper.js';

/**
 * Bounds findDuplicateSuggestions' O(n^2) pairwise scan (see
 * docs/specs/company-fk-phase5c.md — intentional at this app's scale) so it
 * can't be driven arbitrarily large via CSV import; also a sane ceiling for
 * a personal target-companies list regardless of the duplicate-detection cost.
 */
const MAX_COMPANIES_PER_USER = 2000;

/** How many of a company's most recent jobs its application history returns. */
const RECENT_HISTORY_JOBS = 3;

/** Minimum `similarityRatio` of normalized names for a pair to be suggested as duplicates. */
const NAME_SIMILARITY_THRESHOLD = 0.85;

/**
 * The user's target-company list: the companies they are tracking, the
 * enrichment attached to each, and the merge and duplicate-detection tools
 * that keep the list from filling with near-identical rows. Every method
 * scopes by `userId`, and a company owned by someone else reads as absent.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
    private logger: Logger,
  ) {}

  /**
   * Friendly-message pre-check for a case-insensitive name clash, matching
   * what `CompaniesImportService` does per CSV row. Correctness under a
   * race comes from the functional unique index on `(userId, lower(name))`,
   * not from this read. Takes a client so `create` can run it inside its
   * transaction.
   */
  private async ensureNameAvailable(
    client: Pick<Prisma.TransactionClient, 'company'> | PrismaService,
    userId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await client.company.findFirst({
      where: {
        ...companyNameMatch(userId, name),
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(`A company named "${name}" already exists`);
    }
  }

  /**
   * Serializable isolation, here for `create`'s per-user cap: two
   * concurrent creates could otherwise both read a count just under it and
   * both write. No index can enforce a cap — name clashes are covered by
   * the unique index, which is why `update` needs no transaction at all.
   *
   * A conflict here is not always a cap race, so the message stays generic
   * rather than assuming which check lost. The conflict test must be
   * `isTransactionWriteConflict`, not a bare `err.code === 'P2034'`: a
   * conflict Postgres only detects at COMMIT time, common for a predicate
   * as broad as this count, surfaces as a raw `DriverAdapterError` instead
   * — see `prisma-errors.ts` for why both shapes matter.
   */
  private async runNameCheckedWrite<T>(
    name: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, {
        isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel,
      });
    } catch (err: unknown) {
      if (isTransactionWriteConflict(err)) {
        throw new ConflictException(
          `Could not save "${name}" — a conflicting change happened at the same time. Please try again.`,
        );
      }
      throw err;
    }
  }

  /**
   * Adds one company and kicks off enrichment for it.
   *
   * A single create auto-triggers enrichment, mirroring
   * `JobsService.create`. CSV import deliberately does not: a bulk import
   * firing dozens of concurrent search and model calls is a real rate-limit
   * and cost risk that one manual add is not. Enrichment stays best-effort
   * — an unreachable queue is logged and the company is still created.
   */
  async create(userId: string, dto: CreateCompanyDto) {
    const company = await this.runNameCheckedWrite(dto.name, async (tx) => {
      // Counted inside the same Serializable transaction as the write below
      // (not as a separate pre-check) — otherwise two concurrent creates can
      // both read a count just under the cap and both pass, landing over it.
      const existingCount = await tx.company.count({ where: { userId } });
      if (existingCount >= MAX_COMPANIES_PER_USER) {
        throw new BadRequestException(
          `You can have at most ${MAX_COMPANIES_PER_USER} target companies`,
        );
      }
      await this.ensureNameAvailable(tx, userId, dto.name);
      return tx.company.create({
        data: {
          userId,
          name: dto.name,
          city: dto.city,
          location: dto.location,
          priority: dto.priority,
          personalNotes: dto.personalNotes,
          websiteUrl: dto.websiteUrl,
          linkedinUrl: dto.linkedinUrl,
          businessMode: dto.businessMode,
          productDescription: dto.productDescription,
          industry: dto.industry,
          companySize: dto.companySize,
          techStack: dto.techStack ?? [],
          cultureSummary: dto.cultureSummary,
        },
      });
    });

    try {
      await this.companyEnrichment.enqueueEnrichment(company.id);
    } catch (err: unknown) {
      // Enrichment is best-effort; company creation always succeeds even if
      // the queue is unreachable — same contract as JobsService.create.
      this.logger.warn('Company enrichment enqueue failed', {
        companyId: company.id,
        err,
      });
      return company;
    }

    // enqueueEnrichment's own update sets exactly these two fields — mirror
    // locally instead of a second round-trip read, so the create response
    // reflects PENDING immediately (no stale-null race against the list's
    // first poll/refetch).
    return {
      ...company,
      status: EnrichmentStatus.PENDING,
      errorMessage: null,
    };
  }

  /**
   * One page of the user's companies, newest first, with optional city,
   * priority and name filters. Application stats are fetched for the page's
   * ids only, so the query count stays fixed however large the page.
   */
  async findAll(userId: string, query: CompanyQueryDto) {
    const { page = 1, limit = 10, city, priority, search } = query;

    const where: Prisma.CompanyWhereInput = {
      userId,
      ...(city && { city }),
      ...(priority && { priority }),
      ...(search && {
        name: { contains: search, mode: 'insensitive' as const },
      }),
    };

    const [companies, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.company.count({ where }),
    ]);
    // Page ids only — a fixed three queries however large the page.
    const stats = await getCompanyApplicationStats(
      this.prisma,
      userId,
      companies.map((c) => c.id),
    );

    return {
      data: companies.map((c) => ({
        ...c,
        applicationStats: stats.get(c.id) ?? { ...EMPTY_APPLICATION_STATS },
      })),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * The company detail view: the row plus its contacts and a lean list of
   * the jobs linked to it — enough to list and link to each job, not to
   * render one.
   */
  async findOne(userId: string, companyId: string) {
    // Scope by userId so a company owned by another user is indistinguishable
    // from one that doesn't exist — same 404-for-both pattern as JobsService.
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, userId },
      include: {
        contacts: { orderBy: { createdAt: 'asc' } },
        // Phase 6 (docs/specs/company-fk-phase6.md) — lean select, not the
        // full Job row; the detail page only needs enough to list and link
        // to each job, not render it.
        jobs: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            position: true,
            status: true,
            appliedAt: true,
          },
        },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    const stats = await getCompanyApplicationStats(this.prisma, userId, [
      company.id,
    ]);
    return {
      ...company,
      applicationStats: stats.get(company.id) ?? { ...EMPTY_APPLICATION_STATS },
    };
  }

  /**
   * Answers "have I applied here before?" for the job-create confirmation
   * step. Matches by name the same way `JobsService.resolveCompanyId` links
   * a job — case-insensitive exact — since the create forms only know the
   * name the user typed.
   */
  async findApplicationHistory(userId: string, name: string) {
    const trimmed = name.trim();
    const company = trimmed
      ? await this.prisma.company.findFirst({
          where: companyNameMatch(userId, trimmed),
          select: { id: true, name: true },
        })
      : null;
    if (!company) return { company: null, stats: null, recentJobs: [] };

    const [stats, recentJobs] = await Promise.all([
      getCompanyApplicationStats(this.prisma, userId, [company.id]),
      this.prisma.job.findMany({
        where: { userId, companyId: company.id },
        orderBy: [{ appliedAt: 'desc' }, { createdAt: 'desc' }],
        take: RECENT_HISTORY_JOBS,
        select: { id: true, position: true, status: true, appliedAt: true },
      }),
    ]);
    return {
      company,
      stats: stats.get(company.id) ?? { ...EMPTY_APPLICATION_STATS },
      recentJobs,
    };
  }

  /**
   * Lean ownership check for writes that do not need the contacts and jobs
   * join.
   */
  async findOwned(userId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, userId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  /**
   * Edits a company.
   *
   * A rename needs no Serializable transaction: the functional unique index
   * on `(userId, lower(name))` rejects a case-variant duplicate that slips
   * past the pre-check in a race (ADR-033), and the P2002 that comes back
   * is translated to the same friendly conflict. The pre-check stays for
   * the common non-racing case.
   */
  async update(userId: string, companyId: string, dto: UpdateCompanyDto) {
    await this.findOwned(userId, companyId);

    const data = {
      name: dto.name,
      city: dto.city,
      location: dto.location,
      priority: dto.priority,
      personalNotes: dto.personalNotes,
      websiteUrl: dto.websiteUrl,
      linkedinUrl: dto.linkedinUrl,
      businessMode: dto.businessMode,
      productDescription: dto.productDescription,
      industry: dto.industry,
      companySize: dto.companySize,
      techStack: dto.techStack,
      cultureSummary: dto.cultureSummary,
    };

    // A rename needs no Serializable transaction: the functional unique index
    // on (userId, lower(name)) rejects a case-variant duplicate that slips
    // past this pre-check in a race, same as JobsService.resolveCompanyId
    // (ADR-033). The pre-check stays for the common non-racing case.
    if (dto.name !== undefined) {
      await this.ensureNameAvailable(this.prisma, userId, dto.name, companyId);
    }

    // Atomic ownership + write, same pattern as remove() — avoids relying
    // solely on the separate findOwned check above.
    let count: number;
    try {
      ({ count } = await this.prisma.company.updateMany({
        where: { id: companyId, userId },
        data,
      }));
    } catch (err: unknown) {
      const code =
        err && typeof err === 'object' && 'code' in err
          ? (err as { code?: unknown }).code
          : undefined;
      if (code === 'P2002' && dto.name !== undefined) {
        throw new ConflictException(
          `A company named "${dto.name}" already exists`,
        );
      }
      throw err;
    }
    if (count === 0) throw new NotFoundException('Company not found');
    return this.prisma.company.findFirstOrThrow({ where: { id: companyId } });
  }

  /**
   * Deletes a company. Ownership and delete are one statement, so nothing
   * can race between checking and removing.
   */
  async remove(userId: string, companyId: string) {
    // Atomic ownership + delete in one query, same pattern as JobsService.remove
    // — avoids a separate existence check racing the delete.
    const { count } = await this.prisma.company.deleteMany({
      where: { id: companyId, userId },
    });
    if (count === 0) throw new NotFoundException('Company not found');
    return { message: 'Company deleted' };
  }

  /**
   * Backs the Refresh button.
   *
   * The status flip is a compare-and-swap that claims the row only if it is
   * not already PENDING or PROCESSING, closing the window where two
   * concurrent requests both see a non-busy status and both enqueue. A
   * caller that loses gets a conflict rather than a second queued run.
   */
  async triggerEnrichment(userId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, userId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');

    // CAS: claim the row by flipping status to PENDING only if it isn't
    // already PENDING/PROCESSING, closing the TOCTOU window where two
    // concurrent requests both read a non-busy status and both enqueue.
    const { count } = await this.prisma.company.updateMany({
      where: {
        id: companyId,
        userId,
        OR: [
          { status: null },
          {
            status: {
              notIn: [EnrichmentStatus.PENDING, EnrichmentStatus.PROCESSING],
            },
          },
        ],
      },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });
    if (count === 0) {
      throw new ConflictException('Enrichment already in progress');
    }

    await this.companyEnrichment.enqueueEnrichment(companyId);
    return { message: 'Enrichment queued' };
  }

  /**
   * Folds a duplicate company into a canonical one and deletes the
   * duplicate. Manual only, no auto-detection — see
   * docs/specs/company-fk-phase5a.md, and company-fk-phase5b.md for the
   * field overrides.
   *
   * Both jobs and contacts must be reassigned first: `Contact.companyId`
   * cascades on delete, so removing the duplicate before moving its
   * contacts would silently destroy them. `fieldOverrides` is a sparse
   * patch onto the canonical row — an absent key keeps the canonical value,
   * and only fields the user explicitly picked the duplicate's value for
   * are overwritten. Only enrichment fields are eligible; user-curated
   * identity fields such as `websiteUrl` and `personalNotes` always stay
   * the canonical company's own.
   *
   * Serializable for the same reason as `runNameCheckedWrite`: two merges
   * naming the same duplicate — a double-click, two tabs — would otherwise
   * both pass the existence check and race on the delete.
   */
  async mergeCompanies(
    userId: string,
    canonicalId: string,
    duplicateId: string,
    fieldOverrides?: MergeFieldOverridesDto,
  ) {
    if (canonicalId === duplicateId) {
      throw new ConflictException('Cannot merge a company with itself');
    }
    try {
      // Serializable, same as runNameCheckedWrite — two concurrent merges
      // naming the same duplicateId (double-click, two tabs) would otherwise
      // both pass the findFirst existence check under the default isolation
      // level and race on the delete/reassignment below. Postgres aborts the
      // loser with P2034 instead.
      return await this.prisma.$transaction(
        async (tx) => {
          const [canonical, duplicate] = await Promise.all([
            tx.company.findFirst({ where: { id: canonicalId, userId } }),
            tx.company.findFirst({
              where: { id: duplicateId, userId },
              select: { id: true, name: true },
            }),
          ]);
          if (!canonical || !duplicate) {
            throw new NotFoundException('Company not found');
          }

          // userId included as defense-in-depth, not the load-bearing check —
          // duplicateId's ownership is already verified by the findFirst
          // above. Guards against a future change ever making companyId
          // client-settable on a Job/Contact write.
          await tx.job.updateMany({
            where: { companyId: duplicateId, userId },
            data: { companyId: canonicalId },
          });
          await tx.contact.updateMany({
            where: { companyId: duplicateId, company: { userId } },
            data: { companyId: canonicalId },
          });
          await tx.company.delete({ where: { id: duplicateId } });

          if (fieldOverrides && Object.keys(fieldOverrides).length > 0) {
            return tx.company.update({
              where: { id: canonicalId },
              data: fieldOverrides,
            });
          }
          return canonical;
        },
        { isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel },
      );
    } catch (err: unknown) {
      if (isTransactionWriteConflict(err)) {
        throw new ConflictException(
          'This company is being merged concurrently — refresh and try again',
        );
      }
      throw err;
    }
  }

  /**
   * Finds likely duplicate pairs among the user's companies, by shared
   * website or by name similarity.
   *
   * Computed fresh per request, with no caching and no background job. The
   * pairwise comparison is quadratic, which is fine at this data volume — a
   * personal job tracker's company list, not a CRM at scale — and the
   * per-user cap is what bounds it; docs/specs/company-fk-phase5c.md has
   * that reasoning, and why this is not Postgres `pg_trgm` instead. Names
   * are normalized once per company
   * rather than once per pair, and a cheap length-ratio bound skips the
   * expensive edit-distance for pairs that cannot clear the threshold. Full
   * company objects come back because the frontend pre-seeds the merge
   * dialog with them.
   */
  async findDuplicateSuggestions(userId: string) {
    const companies = await this.prisma.company.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    const suggestions: {
      companyA: (typeof companies)[number];
      companyB: (typeof companies)[number];
      reason: 'website' | 'name';
    }[] = [];

    // Normalized once per company, not once per pair: normalizeCompanyName
    // builds a RegExp per suffix, and at MAX_COMPANIES_PER_USER the pair
    // loop below runs ~2M times on every companies-page mount.
    const normalized = companies.map((c) => ({
      website: c.websiteUrl ? normalizeWebsiteUrl(c.websiteUrl) : null,
      name: normalizeCompanyName(c.name),
    }));

    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        const a = companies[i];
        const b = companies[j];

        if (
          normalized[i].website &&
          normalized[i].website === normalized[j].website
        ) {
          suggestions.push({ companyA: a, companyB: b, reason: 'website' });
          continue;
        }

        // Edit distance is never less than the length gap, so this ratio is
        // an upper bound on similarityRatio's — below the threshold, skip the
        // O(len^2) Levenshtein. Same expression shape as similarityRatio, so
        // a pair exactly on the threshold is never skipped by rounding.
        const nameA = normalized[i].name;
        const nameB = normalized[j].name;
        const maxLength = Math.max(nameA.length, nameB.length);
        if (
          maxLength > 0 &&
          1 - Math.abs(nameA.length - nameB.length) / maxLength <
            NAME_SIMILARITY_THRESHOLD
        ) {
          continue;
        }

        const ratio = similarityRatio(nameA, nameB);
        if (ratio >= NAME_SIMILARITY_THRESHOLD) {
          suggestions.push({ companyA: a, companyB: b, reason: 'name' });
        }
      }
    }

    return suggestions;
  }
}
