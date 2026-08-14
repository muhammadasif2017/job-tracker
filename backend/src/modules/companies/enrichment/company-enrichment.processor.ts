import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { WebFetchService } from '../../enrichment/services/web-fetch.service.js';
import { SearchService } from '../../enrichment/services/search.service.js';
import {
  LlmService,
  type CompanyData,
} from '../../enrichment/services/llm.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';

type ExtractionResult = {
  data: CompanyData;
  lowConfidence: { address: boolean; headquarters: boolean };
};

// Same list as EnrichmentProcessor's JOB_BOARD_DOMAINS — a Company.websiteUrl
// pointing at one of these (e.g. a pasted LinkedIn company page) is not the
// company's own domain and must not be used as a trust hint.
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
// See EnrichmentProcessor for why 90s — same stall-detection margin, same
// BullMQ renewal cadence.
@Processor(COMPANY_ENRICHMENT_QUEUE, { lockDuration: 90_000 })
export class CompanyEnrichmentProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webFetch: WebFetchService,
    private readonly search: SearchService,
    private readonly llm: LlmService,
    private readonly logger: Logger,
  ) {
    super();
  }

  async process(job: Job<{ companyId: string }>): Promise<void> {
    const { companyId } = job.data;
    const startedAt = Date.now();

    const dbCompany = await this.prisma.company.findFirst({
      where: { id: companyId },
    });
    if (!dbCompany) {
      this.logger.warn('company_enrichment_not_found', { companyId });
      return;
    }

    const company = dbCompany.name;
    const location = dbCompany.location ?? undefined;
    const domain = this.extractDomain(dbCompany.websiteUrl);
    this.logger.log('company_enrichment_started', { companyId, company });

    let extraction: ExtractionResult | undefined;

    try {
      await this.prisma.company.update({
        where: { id: companyId },
        data: { status: EnrichmentStatus.PROCESSING, errorMessage: null },
      });

      const locationSuffix = location ? ` ${location}` : '';
      const generalQuery = `"${company}"${locationSuffix} company overview headquarters address founded employees industry tech stack work culture reviews`;
      const snippets = await this.search.search(generalQuery);

      // No job-posting page to fetch here (unlike EnrichmentProcessor) —
      // a target Company has no associated posting URL. Official-site
      // fetches only fire when websiteUrl resolves to a real (non-job-board)
      // domain.
      const [homepageText, aboutText, primaryContactText] = await Promise.all([
        domain
          ? this.webFetch.fetchPageText(`https://${domain}`)
          : Promise.resolve(''),
        domain
          ? this.webFetch.fetchPageText(`https://${domain}/about`)
          : Promise.resolve(''),
        domain
          ? this.webFetch.fetchPageText(`https://${domain}/contact`)
          : Promise.resolve(''),
      ]);
      const contactTexts = primaryContactText
        ? [primaryContactText]
        : domain
          ? [await this.webFetch.fetchPageText(`https://${domain}/contact-us`)]
          : [];

      const newOfficialText = [...contactTexts, aboutText, homepageText].join(
        '',
      );
      const shouldFallbackSearch =
        domain !== undefined && newOfficialText.length < 300;
      const domainSnippets = shouldFallbackSearch
        ? await this.search.search(generalQuery, {
            includeDomains: [domain],
          })
        : [];

      const officialParts = [
        ...new Set([
          ...contactTexts,
          aboutText,
          homepageText,
          ...domainSnippets,
        ]),
      ].filter(Boolean);
      const searchParts = [...new Set(snippets)].filter(Boolean);

      const sections: string[] = [];
      if (officialParts.length && domain) {
        sections.push(
          `=== OFFICIAL COMPANY WEBSITE (${domain}) ===\n${officialParts.join('\n\n').slice(0, 6000)}`,
        );
      }
      if (searchParts.length) {
        sections.push(
          `=== WEB SEARCH RESULTS (may describe other companies with similar names) ===\n` +
            searchParts.join('\n\n').slice(0, 3500),
        );
      }
      const context = sections.join('\n\n');

      this.logger.debug('company_enrichment_context', {
        companyId,
        company,
        snippetCount: snippets.length,
        contactTextLengths: contactTexts.map((t) => t.length),
        context,
      });

      const data = await this.llm.extract(company, context, {
        domain,
        location,
      });

      // Same confidence guard as EnrichmentProcessor — same thresholds, same
      // reasoning (a same-name company in search results can otherwise poison
      // address/headquarters).
      const officialTokens = new Set(
        this.normalize(officialParts.join(' ')).split(' ').filter(Boolean),
      );
      const guardThresholds: Record<'address' | 'headquarters', number> = {
        address: 0.7,
        headquarters: 0.25,
      };
      const lowConfidence: Record<'address' | 'headquarters', boolean> = {
        address: false,
        headquarters: false,
      };
      for (const field of ['address', 'headquarters'] as const) {
        const value = data[field];
        if (!value || value === 'Unknown') continue;
        const tokens = this.normalize(value).split(' ').filter(Boolean);
        const hits = tokens.filter((t) => officialTokens.has(t)).length;
        if (!tokens.length || hits / tokens.length < guardThresholds[field]) {
          this.logger.log('company_enrichment_field_low_confidence', {
            companyId,
            company,
            field,
            value,
          });
          lowConfidence[field] = true;
        }
      }

      extraction = { data, lowConfidence };

      const stillExists = await this.prisma.company.findFirst({
        where: { id: companyId },
      });
      if (!stillExists) {
        this.logger.log('company_enrichment_deleted_during_processing', {
          companyId,
        });
        return;
      }

      await this.prisma.company.update({
        where: { id: companyId },
        data: this.buildCompletedProfileData(extraction),
      });

      this.logger.log('company_enrichment_completed', {
        companyId,
        company,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      const raw = error instanceof Error ? error.message : 'Enrichment failed';
      const errorMessage = raw
        .replace(/https?:\/\/\S+/g, '[url]')
        .slice(0, 200);

      this.logger.warn('company_enrichment_failed', {
        companyId,
        company,
        error: errorMessage,
        durationMs: Date.now() - startedAt,
      });

      const stillExists = await this.prisma.company.findFirst({
        where: { id: companyId },
      });
      if (stillExists) {
        const salvaged = await this.recordFailureOutcome(
          companyId,
          company,
          extraction,
          errorMessage,
          startedAt,
        );
        if (salvaged) return;
      }

      throw error;
    }
  }

  private async recordFailureOutcome(
    companyId: string,
    company: string,
    extraction: ExtractionResult | undefined,
    errorMessage: string,
    startedAt: number,
  ): Promise<boolean> {
    const phase: 'salvage' | 'mark_failed' = extraction
      ? 'salvage'
      : 'mark_failed';
    try {
      if (extraction) {
        await this.prisma.company.update({
          where: { id: companyId },
          data: this.buildCompletedProfileData(extraction),
        });
        this.logger.log('company_enrichment_completed_after_late_failure', {
          companyId,
          company,
          error: errorMessage,
          durationMs: Date.now() - startedAt,
        });
        return true;
      }

      await this.prisma.company.update({
        where: { id: companyId },
        data: { status: EnrichmentStatus.FAILED, errorMessage },
      });
      return false;
    } catch (updateErr) {
      this.logger.warn('company_enrichment_profile_update_failed', {
        companyId,
        phase,
        error:
          updateErr instanceof Error ? updateErr.message : String(updateErr),
      });
      return false;
    }
  }

  private buildCompletedProfileData(extraction: ExtractionResult) {
    return {
      status: EnrichmentStatus.COMPLETED,
      ...extraction.data,
      addressLowConfidence: extraction.lowConfidence.address,
      headquartersLowConfidence: extraction.lowConfidence.headquarters,
      enrichedAt: new Date(),
    };
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
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
