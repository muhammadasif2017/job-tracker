import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { EnrichmentStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../prisma/prisma.service.js';
import { WebFetchService } from './services/web-fetch.service.js';
import { SearchService } from './services/search.service.js';
import { LlmService, type CompanyData } from './services/llm.service.js';

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
// lockDuration is stall-detection margin (crashed worker / blocked event
// loop failing to renew the lock), not a runtime ceiling — BullMQ renews the
// lock at lockDuration/2 while the job is actively processing. 90s comfortably
// exceeds that ~45s renewal cadence without being so tight that a transient
// GC pause causes a false stall detection.
@Processor(ENRICHMENT_QUEUE, { lockDuration: 90_000 })
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

    // Set once extraction + the guard both succeed. If a later step then
    // throws (e.g. the final DB write itself hiccups), the catch block below
    // uses this to salvage the already-extracted data as a COMPLETED write
    // instead of discarding it in favor of a bare FAILED status.
    let extraction:
      | {
          data: CompanyData;
          lowConfidence: { address: boolean; headquarters: boolean };
        }
      | undefined;

    try {
      await this.prisma.companyProfile.upsert({
        where: { jobId },
        create: { jobId, status: EnrichmentStatus.PROCESSING },
        update: { status: EnrichmentStatus.PROCESSING, errorMessage: null },
      });

      const locationSuffix = location ? ` ${location}` : '';
      const generalQuery = `"${company}"${locationSuffix} company overview headquarters address founded employees industry tech stack work culture reviews`;
      const snippets = await this.search.search(generalQuery);

      // With a real company domain, also fetch its homepage, /about, and
      // /contact page — the only reliable sources for facts like industry,
      // founded year, headquarters, and street address (same-name companies
      // in the same city poison search results). Try /contact first; only hit
      // /contact-us (a second network call) if the first one came back empty.
      const [pageText, homepageText, aboutText, primaryContactText] =
        await Promise.all([
          this.webFetch.fetchPageText(dbJob.url ?? ''),
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

      // Conditional fallback: only when the company's own pages came back
      // thin (fetch failure / thin site), not routinely — an always-on second
      // Tavily call would double quota usage for the common case, since a
      // domain is known for most real (non-job-board) postings. `pageText`
      // (the job-posting page) is deliberately excluded from this check — it's
      // unrelated to whether the new official fetches succeeded and routinely
      // exceeds the threshold on its own, which would otherwise mask a thin
      // official fetch and make the fallback almost never fire.
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

      // Contact text first — it's most likely to carry the address, and is
      // short; then /about (likely to carry founding/HQ prose); then the
      // homepage (marketing-heavy, least structured); job-posting page last
      // (lowest-priority, most marketing-heavy source). This order matters
      // under truncation below — otherwise homepage/marketing text could
      // crowd out the address-bearing contact text.
      const officialParts = [
        ...new Set([
          ...contactTexts,
          aboutText,
          homepageText,
          ...domainSnippets,
          pageText,
        ]),
      ].filter(Boolean);
      const searchParts = [...new Set(snippets)].filter(Boolean);

      const sections: string[] = [];
      if (officialParts.length) {
        const label = domain
          ? `=== OFFICIAL COMPANY WEBSITE (${domain}) ===`
          : '=== JOB POSTING PAGE ===';
        sections.push(`${label}\n${officialParts.join('\n\n').slice(0, 6000)}`);
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
        snippetCount: snippets.length,
        pageTextLength: pageText.length,
        contactTextLengths: contactTexts.map((t) => t.length),
        context,
      });

      const data = await this.llm.extract(company, context, {
        domain,
        location,
      });

      // Deterministic guard: prompt instructions alone don't stop the LLM from
      // taking an address/headquarters from a same-name company in search
      // results. Accept a value at full confidence only if enough of its
      // tokens appear as exact tokens (not substrings — "inc" must not match
      // inside "increasing") in content from the company's own pages.
      // `address` keeps a strict 0.7 bar (its extraction prompt already
      // restricts sourcing to official pages); `headquarters` uses a looser
      // 0.25 bar since its prompt has no such restriction and short
      // city/region facts legitimately show up in search-sourced content too.
      //
      // Below the bar, the value is kept (not wiped to "Unknown") but flagged
      // low-confidence — the product preference here is "some information,
      // possibly wrong" over "no information" for these two fields, same as
      // every other unguarded field already gets. The frontend surfaces the
      // flag so the user can judge for themselves rather than being misled by
      // an unqualified value. Because a below-bar value is now shown (just
      // flagged) rather than hidden, the cost of a false-reject is lower than
      // it was when this guard wiped to "Unknown" — headquarters was loosened
      // from 0.4 to 0.25 on that basis (address stays at 0.7: a wrong street
      // address is still the single worst failure mode, ADR-013).
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
          this.logger.log('enrichment_field_low_confidence', {
            jobId,
            company,
            field,
            value,
          });
          lowConfidence[field] = true;
        }
      }

      extraction = { data, lowConfidence };

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
          addressLowConfidence: lowConfidence.address,
          headquartersLowConfidence: lowConfidence.headquarters,
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
        // Distinguishes the two failure modes below in
        // `enrichment_profile_update_failed` — "salvage" (already-extracted
        // data lost on a double DB failure, the worse outcome) vs
        // "mark_failed" (couldn't even record that the run failed).
        const phase: 'salvage' | 'mark_failed' = extraction
          ? 'salvage'
          : 'mark_failed';
        try {
          if (extraction) {
            // Extraction (and the guard) already succeeded — whatever threw
            // was a late step (the stillExists re-check or the COMPLETED
            // write itself). Salvage the already-extracted data rather than
            // discarding it in favor of an empty FAILED profile.
            await this.prisma.companyProfile.update({
              where: { jobId },
              data: {
                status: EnrichmentStatus.COMPLETED,
                ...extraction.data,
                addressLowConfidence: extraction.lowConfidence.address,
                headquartersLowConfidence: extraction.lowConfidence.headquarters,
                enrichedAt: new Date(),
              },
            });
            this.logger.log('enrichment_completed_after_late_failure', {
              jobId,
              company,
              error: errorMessage,
              durationMs: Date.now() - startedAt,
            });
            return;
          }

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
            phase,
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
