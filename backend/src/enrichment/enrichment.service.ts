import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { ENRICHMENT_QUEUE } from './enrichment.processor.js';

@Injectable()
export class EnrichmentService {
  constructor(
    @InjectQueue(ENRICHMENT_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueEnrichment(jobId: string): Promise<void> {
    await this.prisma.companyProfile.upsert({
      where: { jobId },
      create: { jobId, status: EnrichmentStatus.PENDING },
      update: {
        status: EnrichmentStatus.PENDING,
        industry: null,
        companySize: null,
        techStack: [],
        cultureSummary: null,
        remotePolicy: null,
        workLifeBalance: null,
        headquarters: null,
        founded: null,
        errorMessage: null,
        enrichedAt: null,
      },
    });
    await this.queue.add(
      'enrich',
      { jobId },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  }
}
