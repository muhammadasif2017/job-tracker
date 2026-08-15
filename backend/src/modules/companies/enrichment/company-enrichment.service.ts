import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';

@Injectable()
export class CompanyEnrichmentService {
  constructor(
    @InjectQueue(COMPANY_ENRICHMENT_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueEnrichment(companyId: string): Promise<void> {
    // Company.status already exists with a PENDING default from creation
    // (unlike Job's CompanyProfile, which is created lazily on first
    // enrichment) — a plain update, no upsert needed.
    await this.prisma.company.update({
      where: { id: companyId },
      data: { status: EnrichmentStatus.PENDING, errorMessage: null },
    });
    await this.queue.add(
      'enrich',
      { companyId },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  }
}
