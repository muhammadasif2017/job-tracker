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

// Bounds findDuplicateSuggestions' O(n^2) pairwise scan (see
// docs/specs/company-fk-phase5c.md — intentional at this app's scale) so it
// can't be driven arbitrarily large via CSV import; also a sane ceiling for
// a personal target-companies list regardless of the duplicate-detection cost.
const MAX_COMPANIES_PER_USER = 2000;

@Injectable()
export class CompaniesService {
  constructor(
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
    private logger: Logger,
  ) {}

  // Case-insensitive companion to the DB's case-sensitive @@unique([userId, name])
  // — matches the check CompaniesImportService already does for CSV rows, so
  // "Google" and "google" can't coexist via either path. Takes a client param
  // so callers can run it inside a Serializable transaction (see create/update)
  // to close the TOCTOU window between this read and the write that follows —
  // Postgres aborts the loser with P2034, which we map back to the same
  // ConflictException.
  private async ensureNameAvailable(
    client: Pick<Prisma.TransactionClient, 'company'> | PrismaService,
    userId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await client.company.findFirst({
      where: {
        userId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId && { id: { not: excludeId } }),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(`A company named "${name}" already exists`);
    }
  }

  // Serializable isolation makes Postgres detect the read-write conflict
  // between two concurrent ensureNameAvailable+write pairs and abort one
  // with P2034, rather than letting both pass the pre-check and both write —
  // the case-insensitive check alone can't close that window since the DB's
  // own unique constraint is case-sensitive.
  private async runNameCheckedWrite<T>(
    name: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, {
        isolationLevel: 'Serializable' as Prisma.TransactionIsolationLevel,
      });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'P2034'
      ) {
        throw new ConflictException(`A company named "${name}" already exists`);
      }
      throw err;
    }
  }

  // Single-company create auto-triggers enrichment (mirrors JobsService.create).
  // CSV import does NOT — see CompaniesImportService; a bulk import firing
  // dozens of concurrent Tavily/Groq calls at once is a real rate-limit/cost
  // risk that a single manual add isn't.
  async create(userId: string, dto: CreateCompanyDto) {
    const existingCount = await this.prisma.company.count({
      where: { userId },
    });
    if (existingCount >= MAX_COMPANIES_PER_USER) {
      throw new BadRequestException(
        `You can have at most ${MAX_COMPANIES_PER_USER} target companies`,
      );
    }

    const company = await this.runNameCheckedWrite(dto.name, async (tx) => {
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
          workPolicy: dto.workPolicy,
          workLifeBalance: dto.workLifeBalance,
          headquarters: dto.headquarters,
          address: dto.address,
          founded: dto.founded,
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

    return {
      data: companies,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

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
            priority: true,
            appliedAt: true,
          },
        },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  // Lean ownership check for write operations that don't need the contacts JOIN.
  async findOwned(userId: string, companyId: string) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, userId },
      select: { id: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

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
      workPolicy: dto.workPolicy,
      workLifeBalance: dto.workLifeBalance,
      headquarters: dto.headquarters,
      address: dto.address,
      founded: dto.founded,
    };

    if (dto.name === undefined) {
      // Atomic ownership + write, same pattern as remove() — avoids relying
      // solely on the separate findOwned check above.
      const { count } = await this.prisma.company.updateMany({
        where: { id: companyId, userId },
        data,
      });
      if (count === 0) throw new NotFoundException('Company not found');
      return this.prisma.company.findFirstOrThrow({ where: { id: companyId } });
    }

    return this.runNameCheckedWrite(dto.name, async (tx) => {
      await this.ensureNameAvailable(tx, userId, dto.name!, companyId);
      return tx.company.update({ where: { id: companyId }, data });
    });
  }

  async remove(userId: string, companyId: string) {
    // Atomic ownership + delete in one query, same pattern as JobsService.remove
    // — avoids a separate existence check racing the delete.
    const { count } = await this.prisma.company.deleteMany({
      where: { id: companyId, userId },
    });
    if (count === 0) throw new NotFoundException('Company not found');
    return { message: 'Company deleted' };
  }

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

  // Phase 5a (docs/specs/company-fk-phase5a.md) — manual merge, no
  // auto-detection yet (5c). Job AND Contact both need reassigning —
  // Contact.companyId has onDelete: Cascade from Company, so deleting the
  // duplicate without first reassigning its contacts would silently destroy
  // them. fieldOverrides (phase 5b, docs/specs/company-fk-phase5b.md) is a
  // sparse patch applied to canonical — an absent key keeps canonical's
  // current value, only present keys (the fields the user explicitly picked
  // the duplicate's value for) get overwritten. Only AI-enrichment fields
  // are eligible; user-curated identity fields (websiteUrl, personalNotes,
  // etc.) always stay canonical's own, no override path for them.
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

          await tx.job.updateMany({
            where: { companyId: duplicateId },
            data: { companyId: canonicalId },
          });
          await tx.contact.updateMany({
            where: { companyId: duplicateId },
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
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code === 'P2034'
      ) {
        throw new ConflictException(
          'This company is being merged concurrently — refresh and try again',
        );
      }
      throw err;
    }
  }

  // Phase 5c (docs/specs/company-fk-phase5c.md) — computed fresh on each
  // request against the current user's own companies only, no caching/
  // background job. O(n^2) pairwise comparison is fine at this data volume
  // (a personal job-tracking tool's per-user company count is small, not a
  // CRM at scale) — see the spec for why this isn't a Postgres pg_trgm
  // extension instead. Full Company objects (not a narrow select) — the
  // frontend pre-seeds MergeCompanyDialog with these, same shape the
  // existing search step already provides.
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

    for (let i = 0; i < companies.length; i++) {
      for (let j = i + 1; j < companies.length; j++) {
        const a = companies[i];
        const b = companies[j];

        if (
          a.websiteUrl &&
          b.websiteUrl &&
          normalizeWebsiteUrl(a.websiteUrl) ===
            normalizeWebsiteUrl(b.websiteUrl)
        ) {
          suggestions.push({ companyA: a, companyB: b, reason: 'website' });
          continue;
        }

        const ratio = similarityRatio(
          normalizeCompanyName(a.name),
          normalizeCompanyName(b.name),
        );
        if (ratio >= 0.85) {
          suggestions.push({ companyA: a, companyB: b, reason: 'name' });
        }
      }
    }

    return suggestions;
  }
}
