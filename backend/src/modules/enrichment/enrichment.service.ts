import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { EnrichmentStatus } from '@prisma/client';
import type { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ENRICHMENT_QUEUE } from './enrichment.processor.js';

@Injectable()
export class EnrichmentService {
  constructor(
    @InjectQueue(ENRICHMENT_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueEnrichment(jobId: string): Promise<void> {
    // On re-run (including a manual "Refresh" of a COMPLETED profile), the
    // previously extracted fields are deliberately left untouched — only
    // status/errorMessage reset. Wiping them here would blank out working
    // data for the entire in-flight window, and leave the user with nothing
    // if the new run then fails; keeping them lets the frontend show
    // last-known-good data (flagged as refreshing) until a new COMPLETED
    // write actually replaces it. See docs/company-profile-enrichment.md §2.
    await this.prisma.companyProfile.upsert({
      where: { jobId },
      create: { jobId, status: EnrichmentStatus.PENDING },
      update: {
        status: EnrichmentStatus.PENDING,
        errorMessage: null,
      },
    });
    await this.queue.add(
      'enrich',
      { jobId },
      { attempts: 2, backoff: { type: 'fixed', delay: 10_000 } },
    );
  }
}
