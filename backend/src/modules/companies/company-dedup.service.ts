import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { isTransactionWriteConflict } from '../../infrastructure/database/prisma-errors.js';
import type { MergeFieldOverridesDto } from './dto/merge-company.dto.js';
import {
  normalizeCompanyName,
  normalizeWebsiteUrl,
  similarityRatio,
} from '../../common/similarity.js';

/** Minimum `similarityRatio` of normalized names for a pair to be suggested as duplicates. */
const NAME_SIMILARITY_THRESHOLD = 0.85;

/**
 * Keeping the target-company list free of near-identical rows: finding the
 * likely duplicate pairs, and folding one company into another.
 *
 * Split out of `CompaniesService` because it shares none of that service's
 * machinery — no enrichment dependency, no name-availability check, no
 * per-user cap to enforce — only Prisma and the ownership convention that
 * every query is scoped by `userId`, so a company owned by someone else
 * reads as absent.
 */
@Injectable()
export class CompanyDedupService {
  constructor(private prisma: PrismaService) {}

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
    // builds a RegExp per suffix, and at CompaniesService's MAX_COMPANIES_PER_USER cap the pair
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
