import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import { WebFetchService } from './services/web-fetch.service.js';
import { SearchService } from './services/search.service.js';
import { LlmService } from './services/llm.service.js';

export const ENRICHMENT_QUEUE = 'company-enrichment';

@Injectable()
@Processor(ENRICHMENT_QUEUE)
export class EnrichmentProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webFetch: WebFetchService,
    private readonly search: SearchService,
    private readonly llm: LlmService,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;

    const dbJob = await this.prisma.job.findFirst({ where: { id: jobId } });
    if (!dbJob) return;

    try {
      await this.prisma.companyProfile.upsert({
        where: { jobId },
        create: { jobId, status: EnrichmentStatus.PROCESSING },
        update: { status: EnrichmentStatus.PROCESSING, errorMessage: null },
      });

      const [cultureSnippets, techSnippets] = await Promise.all([
        this.search.search(`${dbJob.company} company culture reviews`),
        this.search.search(`${dbJob.company} tech stack engineering`),
      ]);

      const pageText = await this.webFetch.fetchPageText(dbJob.url ?? '');

      const context = [...cultureSnippets, ...techSnippets, pageText]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 8000);

      const data = await this.llm.extract(dbJob.company, context);

      await this.prisma.companyProfile.update({
        where: { jobId },
        data: {
          status: EnrichmentStatus.COMPLETED,
          ...data,
          enrichedAt: new Date(),
        },
      });
    } catch (error) {
      try {
        const raw =
          error instanceof Error ? error.message : 'Enrichment failed';
        const errorMessage = raw
          .replace(/https?:\/\/\S+/g, '[url]')
          .slice(0, 200);
        await this.prisma.companyProfile.update({
          where: { jobId },
          data: {
            status: EnrichmentStatus.FAILED,
            errorMessage,
          },
        });
      } catch {
        // Profile was deleted (cascaded from job deletion); nothing to update.
      }
    }
  }
}
