import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebFetchService } from './services/web-fetch.service.js';
import { SearchService } from './services/search.service.js';
import { LlmService } from './services/llm.service.js';

export const ENRICHMENT_QUEUE = 'company-enrichment';

// Hosts that are job boards, not the company's own site — their domain must not
// be used as a trust hint or for contact-page fetching
const JOB_BOARD_DOMAINS = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'rozee.pk',
  'bayt.com',
  'monster.com',
  'ziprecruiter.com',
  'wellfound.com',
];

@Injectable()
@Processor(ENRICHMENT_QUEUE)
export class EnrichmentProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webFetch: WebFetchService,
    private readonly search: SearchService,
    private readonly llm: LlmService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ jobId: string }>): Promise<void> {
    const { jobId } = job.data;
    const startedAt = Date.now();

    const dbJob = await this.prisma.job.findFirst({ where: { id: jobId } });
    if (!dbJob) {
      this.logger.warn('enrichment_job_not_found', { jobId });
      return;
    }

    const company = dbJob.company;
    const location = dbJob.location ?? undefined;
    const domain = this.extractDomain(dbJob.url);
    this.logger.log('enrichment_started', { jobId, company });

    try {
      await this.prisma.companyProfile.upsert({
        where: { jobId },
        create: { jobId, status: EnrichmentStatus.PROCESSING },
        update: { status: EnrichmentStatus.PROCESSING, errorMessage: null },
      });

      const locationSuffix = location ? ` ${location}` : '';
      const [overviewSnippets, cultureSnippets] = await Promise.all([
        this.search.search(
          `"${company}"${locationSuffix} company overview headquarters address founded employees industry`,
        ),
        this.search.search(
          `"${company}"${locationSuffix} tech stack work culture reviews`,
        ),
      ]);

      // With a real company domain, also fetch its contact page — the only
      // reliable source for the street address (same-name companies in the same
      // city poison search results)
      const [pageText, ...contactTexts] = await Promise.all([
        this.webFetch.fetchPageText(dbJob.url ?? ''),
        ...(domain
          ? [
              this.webFetch.fetchPageText(`https://${domain}/contact`),
              this.webFetch.fetchPageText(`https://${domain}/contact-us`),
            ]
          : []),
      ]);

      // Contact pages first — they carry the address and are short; the homepage
      // is marketing text that would otherwise fill the section cap alone
      const officialParts = [...new Set([...contactTexts, pageText])].filter(
        Boolean,
      );
      // Set dedupes snippets returned by both queries (wastes context budget)
      const searchParts = [
        ...new Set([...overviewSnippets, ...cultureSnippets]),
      ].filter(Boolean);

      const sections: string[] = [];
      if (officialParts.length) {
        const label = domain
          ? `=== OFFICIAL COMPANY WEBSITE (${domain}) ===`
          : '=== JOB POSTING PAGE ===';
        sections.push(`${label}\n${officialParts.join('\n\n').slice(0, 4500)}`);
      }
      if (searchParts.length) {
        sections.push(
          `=== WEB SEARCH RESULTS (may describe other companies with similar names) ===\n` +
            searchParts.join('\n\n').slice(0, 3500),
        );
      }
      const context = sections.join('\n\n');

      // Full context visible with LOG_LEVEL=debug — for diagnosing wrong extractions
      this.logger.debug('enrichment_context', {
        jobId,
        company,
        overviewSnippetCount: overviewSnippets.length,
        cultureSnippetCount: cultureSnippets.length,
        pageTextLength: pageText.length,
        contactTextLengths: contactTexts.map((t) => t.length),
        context,
      });

      const data = await this.llm.extract(company, context, {
        domain,
        location,
      });

      const stillExists = await this.prisma.job.findFirst({
        where: { id: jobId },
      });
      if (!stillExists) {
        this.logger.log('enrichment_job_deleted_during_processing', {
          jobId,
        });
        return;
      }

      await this.prisma.companyProfile.update({
        where: { jobId },
        data: {
          status: EnrichmentStatus.COMPLETED,
          ...data,
          enrichedAt: new Date(),
        },
      });

      this.logger.log('enrichment_completed', {
        jobId,
        company,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Enrichment failed';
      const errorMessage = raw
        .replace(/https?:\/\/\S+/g, '[url]')
        .slice(0, 200);

      this.logger.warn('enrichment_failed', {
        jobId,
        company,
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      const stillExists = await this.prisma.job.findFirst({
        where: { id: jobId },
      });
      if (stillExists) {
        try {
          await this.prisma.companyProfile.update({
            where: { jobId },
            data: {
              status: EnrichmentStatus.FAILED,
              errorMessage,
            },
          });
        } catch (updateErr) {
          this.logger.warn('enrichment_profile_update_failed', {
            jobId,
            error:
              updateErr instanceof Error
                ? updateErr.message
                : String(updateErr),
          });
        }
      }

      throw error;
    }
  }

  private extractDomain(url: string | null): string | undefined {
    if (!url) return undefined;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const isJobBoard = JOB_BOARD_DOMAINS.some(
        (b) => host === b || host.endsWith(`.${b}`),
      );
      return isJobBoard ? undefined : host;
    } catch {
      return undefined;
    }
  }
}
