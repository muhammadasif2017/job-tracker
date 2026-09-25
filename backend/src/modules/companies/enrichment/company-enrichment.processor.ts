import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { EnrichmentStatus, type Company } from '@prisma/client';
import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { Logger } from 'nestjs-pino';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { WebFetchService } from '../../enrichment/services/web-fetch.service.js';
import {
  SearchService,
  SearchUnavailableError,
} from '../../enrichment/services/search.service.js';
import {
  LlmService,
  type CompanyData,
} from '../../enrichment/services/llm.service.js';
import { COMPANY_ENRICHMENT_QUEUE } from './company-enrichment.constants.js';
import { runJobWithRequestId } from '../../../common/request-context.helper.js';
import { JOB_BOARD_DOMAINS } from '../../../common/job-board-domains.js';
import { techFromJobTitles } from '../../../common/tech-tokens.js';
import { withWorkerConnection } from '../../../infrastructure/redis/redis-connection.helper.js';

/**
 * Slack added to the circuit's remaining cool-down before a deferred job
 * runs again, so it lands after the circuit is ready for its trial rather
 * than a few milliseconds before.
 */
const CIRCUIT_DELAY_MARGIN_MS = 1_000;
/**
 * Character budget for the official-website section of the assembled LLM
 * context. Both budgets sit well inside gpt-oss-120b's window: the previous
 * 6000/3500 pair capped the whole context at ~9500 characters, which made the
 * budget - not the model - the binding constraint on extraction quality.
 * 16000 admits a full homepage and /about (WebFetchService caps each page at
 * LLM_CONTEXT_BUDGET = 8000). See ADR-038.
 */
const OFFICIAL_SECTION_BUDGET = 16_000;
/**
 * Character budget for the web-search section. 8000 admits all five Tavily
 * snippets plus the `[Summary]` that SearchService deliberately appends last;
 * at 3500 that summary was routinely cut off entirely. See ADR-038.
 */
const SEARCH_SECTION_BUDGET = 8_000;

/**
 * Worker that builds a target company's profile: gathers official-site text,
 * web search snippets and the user's tracked job titles, has the LLM extract
 * the profile fields, and writes them back without discarding last-known-good
 * data.
 *
 * `lockDuration` of 90s is stall-detection margin, not a runtime ceiling:
 * BullMQ renews the lock while `process()` is running, so it only expires if
 * the worker crashes or its event loop is blocked. See
 * docs/company-profile-enrichment.md §3.
 */
@Injectable()
@Processor(
  COMPANY_ENRICHMENT_QUEUE,
  withWorkerConnection({ lockDuration: 90_000 }),
)
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

  /**
   * Runs the job inside the correlation context of the request that enqueued
   * it, so its log lines share that request's `requestId` (ADR-049).
   */
  async process(
    job: Job<{ companyId: string; requestId?: string }>,
    token?: string,
  ): Promise<void> {
    return runJobWithRequestId(job, () => this.enrich(job, token));
  }

  /**
   * Runs one enrichment attempt for a company. Search quota and bad-key
   * failures that leave no context throw `UnrecoverableError` so BullMQ does
   * not retry them; other failures rethrow for a retry unless an extraction
   * was already salvaged. A company deleted mid-run is left alone.
   */
  private async enrich(
    job: Job<{ companyId: string }>,
    token?: string,
  ): Promise<void> {
    const { companyId } = job.data;
    const startedAt = Date.now();

    const dbCompany = await this.prisma.company.findFirst({
      where: { id: companyId },
    });
    if (!dbCompany) {
      this.logger.warn('company_enrichment_not_found', { companyId });
      return;
    }

    // While the Groq circuit is open the extraction at the end is certain to
    // fail fast, so running now would spend Tavily searches and page fetches
    // for nothing and burn both attempts inside one cool-down (ADR-048).
    // Park the job until the circuit allows its trial call instead. A
    // delayed job keeps its attempts, and the row stays PENDING ("Queued").
    const circuit = this.llm.circuitStatus();
    if (circuit.state === 'open' && circuit.retryAfterMs) {
      const delayMs = circuit.retryAfterMs + CIRCUIT_DELAY_MARGIN_MS;
      this.logger.log('company_enrichment_deferred_circuit_open', {
        companyId,
        delayMs,
      });
      await job.moveToDelayed(Date.now() + delayMs, token);
      throw new DelayedError();
    }

    const company = dbCompany.name;
    const location = dbCompany.location ?? undefined;
    const domain = this.extractDomain(dbCompany.websiteUrl);
    this.logger.log('company_enrichment_started', { companyId, company });

    let extraction: CompanyData | undefined;
    // Set only when a search call fails for an account-level reason (quota
    // exhausted, bad key) rather than genuinely finding nothing. Read only
    // if the run ends up with zero context — a search failure that still
    // leaves the official-site fetch usable shouldn't hard-fail the run.
    let searchUnavailableReason: string | undefined;
    const search = async (
      q: string,
      opts?: { includeDomains?: string[] },
    ): Promise<string[]> => {
      try {
        return await this.search.search(q, opts);
      } catch (err) {
        if (err instanceof SearchUnavailableError) {
          searchUnavailableReason = err.message;
          return [];
        }
        throw err;
      }
    };

    try {
      await this.prisma.company.update({
        where: { id: companyId },
        data: { status: EnrichmentStatus.PROCESSING, errorMessage: null },
      });

      // Only `position` is selected: `notes` is the user's private free text
      // (recruiter names, salary talk) and carries no technology signal, so it
      // stays out of the prompt.
      const linkedJobs = await this.prisma.job.findMany({
        where: { companyId, userId: dbCompany.userId },
        select: { position: true },
      });

      const locationSuffix = location ? ` ${location}` : '';
      const generalQuery = `"${company}"${locationSuffix} company overview employees industry tech stack work culture`;
      const snippets = await search(generalQuery);

      // No job-posting page to fetch here (unlike EnrichmentProcessor) —
      // a target Company has no associated posting URL. Official-site
      // fetches only fire when websiteUrl resolves to a real (non-job-board)
      // domain.
      //
      // Homepage first, then /about: those two carry the industry,
      // positioning and culture prose the five extracted fields are made of,
      // and OFFICIAL_SECTION_BUDGET is spent in that order. ADR-013 placed
      // contact-page text ahead of the homepage so a street address would
      // survive the budget, but the `address` field it protected no longer
      // exists on any model - so fetching /contact and /contact-us bought
      // nothing and evicted the homepage. See ADR-038.
      const [homepageText, aboutText] = await Promise.all([
        domain
          ? this.webFetch.fetchPageText(`https://${domain}`)
          : Promise.resolve(''),
        domain
          ? this.webFetch.fetchPageText(`https://${domain}/about`)
          : Promise.resolve(''),
      ]);

      const newOfficialText = [homepageText, aboutText].join('');
      // `searchUnavailableReason` set means the general search above already
      // came back 429/432 (quota) or 401/403 (bad key) — an account-level
      // failure, so this second search would fail the same way. Skipping it
      // saves a guaranteed-wasted call on exactly the runs where the quota
      // is already the problem.
      const shouldFallbackSearch =
        domain !== undefined &&
        newOfficialText.length < 300 &&
        !searchUnavailableReason;
      const domainSnippets = shouldFallbackSearch
        ? await search(generalQuery, {
            includeDomains: [domain],
          })
        : [];

      const officialParts = [
        ...new Set([homepageText, aboutText, ...domainSnippets]),
      ].filter(Boolean);
      const searchParts = [...new Set(snippets)].filter(Boolean);

      const sections: string[] = [];
      if (officialParts.length && domain) {
        sections.push(
          `=== OFFICIAL COMPANY WEBSITE (${domain}) ===\n${officialParts.join('\n\n').slice(0, OFFICIAL_SECTION_BUDGET)}`,
        );
      }
      // Job titles the user actually tracked at this company are the one
      // first-party source of technology names in the pipeline: a homepage
      // says what a company sells, and search snippets hand back site-scanner
      // output (Twemoji, JSON-LD) rather than an engineering stack. "Senior
      // React Developer" does neither.
      if (linkedJobs.length) {
        const roles = [
          ...new Set(linkedJobs.map((j) => j.position.trim()).filter(Boolean)),
        ];
        if (roles.length) {
          sections.push(
            `=== ROLES THE USER TRACKED AT THIS COMPANY (first-party) ===\n` +
              roles.join('\n'),
          );
        }
      }

      if (searchParts.length) {
        sections.push(
          `=== WEB SEARCH RESULTS (may describe other companies with similar names) ===\n` +
            searchParts.join('\n\n').slice(0, SEARCH_SECTION_BUDGET),
        );
      }
      const context = sections.join('\n\n');

      this.logger.debug('company_enrichment_context', {
        companyId,
        company,
        snippetCount: snippets.length,
        homepageTextLength: homepageText.length,
        aboutTextLength: aboutText.length,
        context,
      });

      // No official-site text and no search snippets — the LLM would see an
      // empty "Web content:" section and (correctly) refuse to call the
      // required extraction tool, which Groq surfaces as a 400
      // tool_use_failed. Fail fast with a clear reason instead of burning an
      // LLM call (and its built-in retry) on a request that can't succeed.
      if (!context.trim()) {
        // A quota/bad-key failure will still be a quota/bad-key failure 10s
        // later, so BullMQ's second attempt can only burn another search
        // call to fail identically — UnrecoverableError skips it. The
        // message is unchanged either way, so ADR-031's frontend
        // RATE_LIMITED/CONFIG classifiers still see what they expect. The
        // no-content cases below stay ordinary Errors: a site that was down
        // or a search that found nothing can genuinely differ on a retry.
        if (searchUnavailableReason) {
          throw new UnrecoverableError(searchUnavailableReason);
        }
        throw new Error(
          domain
            ? 'No extractable content: official site fetch and web search both returned nothing'
            : 'No extractable content: no website on file and web search returned nothing',
        );
      }

      const data = await this.llm.extract(company, context, {
        domain,
        location,
      });

      // Technologies named in the titles the user tracked here are merged in
      // deterministically. Three prompt revisions failed to make the model
      // treat "Senior React Developer" as evidence that this company works
      // with React - the same instruction-following ceiling ADR-013 hit - so
      // the reliable half is done in code. Extraction still leads; these only
      // add. See ADR-042.
      const titleTech = techFromJobTitles(linkedJobs.map((j) => j.position));
      extraction = {
        ...data,
        techStack: [...new Set([...data.techStack, ...titleTech])],
      };

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
        data: this.buildCompletedProfileData(extraction, stillExists),
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
          stillExists,
          errorMessage,
          startedAt,
        );
        if (salvaged) return;
      }

      throw error;
    }
  }

  /**
   * Records the outcome of a run that threw. If the LLM extraction already
   * succeeded before a later step failed, saves it as a completed profile and
   * returns true so the job is not retried; otherwise marks the company
   * FAILED and returns false. Never throws — a failed status write is only
   * logged, so the original error is what reaches BullMQ.
   */
  private async recordFailureOutcome(
    companyId: string,
    company: string,
    extraction: CompanyData | undefined,
    previous: Company,
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
          data: this.buildCompletedProfileData(extraction, previous),
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

  /**
   * The COMPLETED update for a fresh extraction, merged field by field with
   * `previous`. A re-run's search/fetch context can be thinner than the run
   * that first populated a field (rate-limited search, official site down,
   * etc.) — the LLM then has nothing to extract and returns null for that
   * field. Falling back to `previous` per field means a weak run only fills
   * gaps or overwrites fields it actually found something for, instead of
   * wiping last-known-good data whenever any single field comes back empty.
   */
  private buildCompletedProfileData(data: CompanyData, previous: Company) {
    return {
      status: EnrichmentStatus.COMPLETED,
      industry: data.industry ?? previous.industry,
      companySize: data.companySize ?? previous.companySize,
      techStack: data.techStack.length ? data.techStack : previous.techStack,
      cultureSummary: data.cultureSummary ?? previous.cultureSummary,
      productDescription:
        data.productDescription ?? previous.productDescription,
      // Unlike every other field here, an existing `businessMode` wins over a
      // freshly extracted one. It is the one AI-fillable column the user also
      // sets deliberately - by hand on the company form, and as the third CSV
      // column in `companies-import.service.ts` - so letting a re-run overwrite
      // it would discard a stated answer in favour of a guess. The prose
      // fields carry no such user intent and keep the usual overwrite
      // behaviour from Assumption 9 of docs/specs/target-companies.md.
      businessMode: previous.businessMode ?? data.businessMode,
      enrichedAt: new Date(),
    };
  }

  /**
   * The bare host of the company's website, or undefined when there is none,
   * it does not parse, or it is a job board — a job board's pages describe
   * the board, not the company.
   */
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
