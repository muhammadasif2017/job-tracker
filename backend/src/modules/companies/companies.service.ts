import {
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
import { CompanyEnrichmentService } from './enrichment/company-enrichment.service.js';

@Injectable()
export class CompaniesService {
  constructor(
    private prisma: PrismaService,
    private companyEnrichment: CompanyEnrichmentService,
    private logger: Logger,
  ) {}

  // Case-insensitive companion to the DB's case-sensitive @@unique([userId, name])
  // — matches the check CompaniesImportService already does for CSV rows, so
  // "Google" and "google" can't coexist via either path.
  private async ensureNameAvailable(
    userId: string,
    name: string,
    excludeId?: string,
  ) {
    const duplicate = await this.prisma.company.findFirst({
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

  // Single-company create auto-triggers enrichment (mirrors JobsService.create).
  // CSV import does NOT — see CompaniesImportService; a bulk import firing
  // dozens of concurrent Tavily/Groq calls at once is a real rate-limit/cost
  // risk that a single manual add isn't.
  async create(userId: string, dto: CreateCompanyDto) {
    await this.ensureNameAvailable(userId, dto.name);
    const company = await this.prisma.company.create({
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
      include: { contacts: { orderBy: { createdAt: 'asc' } } },
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
    if (dto.name !== undefined) {
      await this.ensureNameAvailable(userId, dto.name, companyId);
    }
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
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
      },
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
}
