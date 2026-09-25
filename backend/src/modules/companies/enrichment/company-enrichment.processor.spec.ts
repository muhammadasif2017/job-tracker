import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { EnrichmentStatus, JobType } from '@prisma/client';
import { CompanyEnrichmentProcessor } from './company-enrichment.processor.js';
import { WebFetchService } from '../../enrichment/services/web-fetch.service.js';
import {
  SearchService,
  SearchUnavailableError,
} from '../../enrichment/services/search.service.js';
import { LlmService } from '../../enrichment/services/llm.service.js';
import { DelayedError } from 'bullmq';
import type { CircuitStatus } from '../../../infrastructure/resilience/circuit-breaker.js';

// `@nestjs/bullmq` v12 added an `exports` map, so the constant can no longer
// be deep-imported from `dist/bull.constants.js`, and the package root does
// not re-export it. The value is the metadata key `@Processor()` writes.
const WORKER_METADATA = 'bullmq:worker_metadata';

// Mirrors enrichment.processor.spec.ts's mock shape — same three injectable
// services, reused unmodified per docs/specs/target-companies.md Assumption 2.
const mockPrisma = {
  company: { findFirst: jest.fn(), update: jest.fn() },
  job: { findMany: jest.fn() },
};
const mockWebFetch = { fetchPageText: jest.fn() } satisfies Pick<
  WebFetchService,
  'fetchPageText'
>;
const mockSearch = { search: jest.fn() } satisfies Pick<
  SearchService,
  'search'
>;
const CIRCUIT_CLOSED: CircuitStatus = {
  name: 'Groq',
  state: 'closed',
  retryAfterMs: null,
};
const mockLlm = {
  extract: jest.fn(),
  circuitStatus: jest.fn((): CircuitStatus => CIRCUIT_CLOSED),
} satisfies Pick<LlmService, 'extract' | 'circuitStatus'>;
const mockLogger = {
  log: jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined),
  warn: jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined),
  error: jest
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined),
  debug: jest
    .spyOn(Logger.prototype, 'debug')
    .mockImplementation(() => undefined),
};

const dbCompany = {
  id: 'company-123',
  userId: 'user-1',
  name: 'Systems Limited',
  websiteUrl: 'https://systemsltd.com',
  location: null,
};
const extracted = {
  industry: 'IT Services',
  companySize: 'Large (1000-5000)',
  techStack: ['Java', '.NET'],
  cultureSummary: 'Structured, process-driven culture.',
  productDescription: 'Digital transformation services for enterprises.',
  businessMode: 'SERVICES',
};
const bullJob = {
  data: { companyId: 'company-123' },
} as Job<{ companyId: string }>;

describe('CompanyEnrichmentProcessor', () => {
  it('sets a 90s lockDuration as stall-detection margin on the @Processor() worker options', () => {
    const workerOptions = Reflect.getMetadata(
      WORKER_METADATA,
      CompanyEnrichmentProcessor,
    ) as { lockDuration?: number } | undefined;

    // The worker connection must keep waiting out a Redis outage; the
    // fail-fast queue connection from BullModule.forRoot would break its
    // blocking commands (ADR-046).
    expect(workerOptions).toMatchObject({
      lockDuration: 90_000,
      connection: { maxRetriesPerRequest: null },
    });
    expect(workerOptions).not.toHaveProperty('connection.enableOfflineQueue');
  });

  let processor: CompanyEnrichmentProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    // No linked jobs unless a test says otherwise, so the ROLES context
    // section is absent by default.
    mockPrisma.job.findMany.mockResolvedValue([]);
    mockLlm.circuitStatus.mockReturnValue(CIRCUIT_CLOSED);
    processor = new CompanyEnrichmentProcessor(
      mockPrisma as never,
      mockWebFetch as never,
      mockSearch as never,
      mockLlm as never,
    );
  });

  it('defers the job while the Groq circuit is open, spending no search or fetch', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-25T10:00:00Z'));
    try {
      mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
      mockLlm.circuitStatus.mockReturnValue({
        name: 'Groq',
        state: 'open',
        retryAfterMs: 20_000,
      });
      const moveToDelayed = jest.fn().mockResolvedValue(undefined);
      const job = { ...bullJob, moveToDelayed } as unknown as Job<{
        companyId: string;
      }>;

      await expect(processor.process(job, 'lock-token')).rejects.toBeInstanceOf(
        DelayedError,
      );

      expect(moveToDelayed).toHaveBeenCalledWith(
        Date.parse('2026-09-25T10:00:21Z'),
        'lock-token',
      );
      expect(mockSearch.search).not.toHaveBeenCalled();
      expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
      expect(mockLlm.extract).not.toHaveBeenCalled();
      // The row stays PENDING ("Queued"), not PROCESSING or FAILED.
      expect(mockPrisma.company.update).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('runs normally once the cool-down is over, since the next call is the trial', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue(['culture snippet']);
    mockWebFetch.fetchPageText.mockResolvedValue('About page text.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockLlm.circuitStatus.mockReturnValue({
      name: 'Groq',
      state: 'open',
      retryAfterMs: 0,
    });

    await processor.process(bullJob);

    expect(mockLlm.extract).toHaveBeenCalled();
  });

  it('runs the full pipeline and marks the company COMPLETED on success', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue(['culture snippet']);
    mockWebFetch.fetchPageText.mockResolvedValue('About page text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-123' },
        data: expect.objectContaining({ status: EnrichmentStatus.PROCESSING }),
      }),
    );
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-123' },
        data: expect.objectContaining({
          status: EnrichmentStatus.COMPLETED,
          industry: 'IT Services',
        }),
      }),
    );
  });

  it('reads Job only for tracked role titles, and writes to Company alone', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    // Read-only, and scoped to the owning user: no write method exists on the
    // Job mock at all, so a write would throw rather than pass silently.
    expect(Object.keys(mockPrisma.job)).toEqual(['findMany']);
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
      where: { companyId: 'company-123', userId: 'user-1' },
      select: { position: true },
    });
    expect(mockPrisma).not.toHaveProperty('companyProfile');
  });

  it('merges technologies named in tracked job titles into techStack', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue({ ...extracted, techStack: ['Java'] });
    mockPrisma.job.findMany.mockResolvedValue([
      { position: 'Senior React Developer' },
      { position: 'Java Backend Engineer' },
    ]);

    await processor.process(bullJob);

    const [call] = mockPrisma.company.update.mock.calls.slice(-1) as [
      { data: { techStack: string[] } },
    ];
    // Extracted value kept, title-derived value added, no duplicate Java.
    expect([...call[0].data.techStack].sort()).toEqual(['Java', 'React']);
  });

  it('passes tracked job titles to the LLM as a first-party section', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.job.findMany.mockResolvedValue([
      { position: 'Senior React Developer', jobType: JobType.ONSITE },
      { position: 'Django Engineer', jobType: JobType.ONSITE },
      { position: 'Django Engineer', jobType: JobType.REMOTE },
    ]);

    await processor.process(bullJob);

    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('ROLES THE USER TRACKED AT THIS COMPANY');
    expect(context).toContain('Senior React Developer');
    // Deduped - the same title tracked twice is one line, not two.
    expect(context.match(/Django Engineer/g)).toHaveLength(1);
  });

  it('has no job-posting page to fetch — official content comes only from websiteUrl-derived pages', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    // homepage + about = 2 calls; no third "job posting page" fetch
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledTimes(2);
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com',
    );
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com/about',
    );
  });

  it('does not fetch official pages when websiteUrl is missing', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({
      ...dbCompany,
      websiteUrl: null,
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue(['culture snippet']);
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
  });

  it('fails fast without calling the LLM when there is no website and search returns nothing', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({
      ...dbCompany,
      websiteUrl: null,
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);

    await expect(processor.process(bullJob)).rejects.toThrow(
      'No extractable content: no website on file and web search returned nothing',
    );

    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
    expect(mockLlm.extract).not.toHaveBeenCalled();
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EnrichmentStatus.FAILED,
          errorMessage:
            'No extractable content: no website on file and web search returned nothing',
        }),
      }),
    );
  });

  it('surfaces the real quota-exceeded reason instead of a generic no-extractable-content message when search is the only content source and it is out of quota', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({
      ...dbCompany,
      websiteUrl: null,
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(
      new SearchUnavailableError(
        'Search quota exceeded (Tavily returned 432) — rate limit reached for this billing period; resets automatically.',
        432,
      ),
    );

    await expect(processor.process(bullJob)).rejects.toThrow(
      /rate limit reached for this billing period/,
    );

    expect(mockLlm.extract).not.toHaveBeenCalled();
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EnrichmentStatus.FAILED,
          errorMessage: expect.stringContaining('rate limit reached'),
        }),
      }),
    );
  });

  // ADR-035. The whole point of the quota guard is to stop spending search
  // calls once the account is out of them, so the run must not fall through
  // to the include_domains fallback search, and BullMQ must not retry it 10s
  // later into an identical 429.
  it('skips the domain-restricted fallback search when the general search is already out of quota', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(
      new SearchUnavailableError('Search quota exceeded', 432),
    );
    // Under the 300-char threshold, so the fallback would fire if unguarded.
    mockWebFetch.fetchPageText.mockResolvedValue('');

    await expect(processor.process(bullJob)).rejects.toThrow();

    expect(mockSearch.search).toHaveBeenCalledTimes(1);
    expect(mockSearch.search).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeDomains: expect.anything() }),
    );
  });

  it('marks a quota failure unrecoverable so BullMQ does not retry it into another 429', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(
      new SearchUnavailableError('Search quota exceeded', 432),
    );
    mockWebFetch.fetchPageText.mockResolvedValue('');

    await expect(processor.process(bullJob)).rejects.toThrow(
      UnrecoverableError,
    );
  });

  // The counterpart: a site that was down or a search that found nothing can
  // genuinely differ on the next attempt, so those stay retryable.
  it('leaves an empty-content failure retryable when search was available', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');

    // Captured rather than asserted through `rejects.not.toBeInstanceOf`,
    // which passes vacuously if the promise shape isn't what you expect.
    const err: unknown = await processor
      .process(bullJob)
      .then(() => undefined)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });

  it('ignores a quota-exceeded search failure and still completes when the official site has enough content', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(
      new SearchUnavailableError('Search quota exceeded', 432),
    );
    mockWebFetch.fetchPageText.mockResolvedValue(
      'A'.repeat(400), // clears the 300-char shouldFallbackSearch threshold
    );
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnrichmentStatus.COMPLETED }),
      }),
    );
  });

  it('fails fast without calling the LLM when the official site fetch and search both come back empty', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');

    await expect(processor.process(bullJob)).rejects.toThrow(
      'No extractable content: official site fetch and web search both returned nothing',
    );

    expect(mockLlm.extract).not.toHaveBeenCalled();
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnrichmentStatus.FAILED }),
      }),
    );
  });

  it('returns early without touching the company when it is not found', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(null);

    await processor.process(bullJob);

    expect(mockPrisma.company.update).not.toHaveBeenCalled();
  });

  it('marks the company FAILED and rethrows for BullMQ retry when search throws', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('Search API down'));

    await expect(processor.process(bullJob)).rejects.toThrow('Search API down');

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EnrichmentStatus.FAILED,
          errorMessage: 'Search API down',
        }),
      }),
    );
  });

  it('does not write a completed profile when the company was deleted mid-run (success path)', async () => {
    mockPrisma.company.findFirst
      .mockResolvedValueOnce(dbCompany) // initial lookup
      .mockResolvedValueOnce(null); // still-exists re-check, post-extraction
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    // PROCESSING is written, but the final COMPLETED write must not happen —
    // exactly one update call (the PROCESSING one), not two.
    expect(mockPrisma.company.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnrichmentStatus.PROCESSING }),
      }),
    );
  });

  it('no-ops instead of writing to the wrong row when the company is merged away as a duplicate mid-run', async () => {
    // Same mechanism as "deleted mid-run" above — mergeCompanies deletes the
    // duplicate row inside its own transaction, which is indistinguishable
    // from any other mid-run deletion from this processor's point of view.
    // The BullMQ job's companyId is fixed at enqueue time to the duplicate's
    // id, so there's no code path that could write extracted data onto the
    // canonical row it got merged into — stillExists just finds nothing and
    // the write is skipped entirely.
    mockPrisma.company.findFirst
      .mockResolvedValueOnce(dbCompany) // initial lookup — company is PROCESSING, then merged away
      .mockResolvedValueOnce(null); // still-exists re-check: this id no longer exists
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'company-123' },
        data: expect.objectContaining({ status: EnrichmentStatus.PROCESSING }),
      }),
    );
    // Never wrote to any id other than the duplicate's own — confirms there's
    // no path that could leak the extraction onto the canonical row.
    for (const call of mockPrisma.company.update.mock.calls) {
      expect((call[0] as { where: { id: string } }).where.id).toBe(
        'company-123',
      );
    }
  });

  it('salvages extracted data on a late failure (write succeeds, later step throws) and does not rethrow', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);
    // First update (PROCESSING) succeeds; the completed-profile write throws
    // (simulating a late failure after extraction succeeded); the salvage
    // retry inside the catch block then succeeds.
    mockPrisma.company.update
      .mockResolvedValueOnce({}) // PROCESSING
      .mockRejectedValueOnce(new Error('DB blip')) // completed write fails
      .mockResolvedValueOnce({}); // salvage retry succeeds

    await expect(processor.process(bullJob)).resolves.toBeUndefined();

    expect(mockPrisma.company.update).toHaveBeenCalledTimes(3);
    expect(mockPrisma.company.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EnrichmentStatus.COMPLETED,
          industry: 'IT Services',
        }),
      }),
    );
  });

  it('rethrows for BullMQ retry when both the completed write and the salvage retry fail', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.company.update
      .mockResolvedValueOnce({}) // PROCESSING
      .mockRejectedValueOnce(new Error('DB blip')) // completed write fails
      .mockRejectedValueOnce(new Error('DB still down')); // salvage retry also fails

    await expect(processor.process(bullJob)).rejects.toThrow('DB blip');
  });

  it('does not attempt to salvage or mark-failed when the company was deleted during failure handling', async () => {
    mockPrisma.company.findFirst
      .mockResolvedValueOnce(dbCompany) // initial lookup
      .mockResolvedValueOnce(null); // still-exists re-check, in the catch block
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('Search API down'));

    await expect(processor.process(bullJob)).rejects.toThrow('Search API down');

    // Only the PROCESSING update should have happened — no FAILED/salvage
    // write against a company that no longer exists.
    expect(mockPrisma.company.update).toHaveBeenCalledTimes(1);
  });

  it('falls back to the previous value for a field a weak re-run could not extract, instead of wiping it', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({
      ...dbCompany,
      industry: 'FinTech',
      productDescription: 'Previously stored description.',
      cultureSummary: 'Small, senior-heavy team.',
      techStack: ['Python'],
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      industry: null,
      productDescription: null,
      cultureSummary: null,
      techStack: [],
    });

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          industry: 'FinTech',
          productDescription: 'Previously stored description.',
          cultureSummary: 'Small, senior-heavy team.',
          techStack: ['Python'],
        }),
      }),
    );
  });

  it('does not treat a job-board host as the company domain', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({
      ...dbCompany,
      websiteUrl: 'https://pk.linkedin.com/company/acme',
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue(['culture snippet']);
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    const [, , disambiguation] = mockLlm.extract.mock.calls[0] as [
      string,
      string,
      { domain?: string; location?: string },
    ];
    expect(disambiguation.domain).toBeUndefined();
    // No homepage/about fetch without a real company domain.
    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
  });

  it('does not fetch contact pages - they feed no extracted field (ADR-038)', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalledWith(
      'https://systemsltd.com/contact',
    );
    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalledWith(
      'https://systemsltd.com/contact-us',
    );
  });

  it('places homepage text ahead of /about in the official section', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/about') ? 'About text.' : 'Homepage text.',
      ),
    );
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context.indexOf('Homepage text.')).toBeLessThan(
      context.indexOf('About text.'),
    );
  });

  it('keeps official content past the old 6000-character section cap', async () => {
    const homepage = 'A'.repeat(5000);
    const about = 'B'.repeat(5000);
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/about') ? about : homepage),
    );
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain(homepage);
    expect(context).toContain(about);
  });

  it('fires a domain-scoped fallback search when official content is thin', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['[systemsltd.com] Domain-scoped snippet.']);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockSearch.search).toHaveBeenCalledTimes(2);
    const [, secondCallOptions] = mockSearch.search.mock.calls[1] as [
      string,
      { includeDomains?: string[] },
    ];
    expect(secondCallOptions).toEqual({ includeDomains: ['systemsltd.com'] });
    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('Domain-scoped snippet.');
  });

  it('does not fire the fallback search when official content is already substantial', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('x'.repeat(400));
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockSearch.search).toHaveBeenCalledTimes(1);
  });

  it('never fires the fallback search without a known company domain', async () => {
    mockPrisma.company.findFirst.mockResolvedValue({
      ...dbCompany,
      websiteUrl: 'https://pk.linkedin.com/company/acme',
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue(['culture snippet']);
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockSearch.search).toHaveBeenCalledTimes(1);
  });

  it('marks the company FAILED and rethrows for BullMQ retry when the LLM throws', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockRejectedValue(new Error('LLM timeout'));

    await expect(processor.process(bullJob)).rejects.toThrow('LLM timeout');

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnrichmentStatus.FAILED }),
      }),
    );
  });

  it('strips URLs from the error message before storing it', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(
      new Error('Failed to fetch https://api.example.com/v1/search?q=acme'),
    );

    await expect(processor.process(bullJob)).rejects.toThrow();

    // calls[0] is the PROCESSING write; calls[1] is the FAILED write that
    // actually carries errorMessage.
    const updateCall = mockPrisma.company.update.mock.calls[1][0] as {
      data: { errorMessage: string };
    };
    expect(updateCall.data.errorMessage).not.toContain('https://');
    expect(updateCall.data.errorMessage).toContain('[url]');
  });

  it('caps the error message at 200 characters', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('x'.repeat(300)));

    await expect(processor.process(bullJob)).rejects.toThrow();

    const updateCall = mockPrisma.company.update.mock.calls[1][0] as {
      data: { errorMessage: string };
    };
    expect(updateCall.data.errorMessage.length).toBeLessThanOrEqual(200);
  });

  it('throws the original error even when the FAILED update itself throws', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update
      .mockResolvedValueOnce({}) // PROCESSING write succeeds
      .mockRejectedValueOnce(new Error('Record to update not found')); // FAILED write fails
    mockSearch.search.mockRejectedValue(new Error('Search API down'));

    await expect(processor.process(bullJob)).rejects.toThrow('Search API down');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'mark_failed' }),
      'company_enrichment_profile_update_failed',
    );
  });
});
