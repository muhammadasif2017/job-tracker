import type { Job } from 'bullmq';
import { EnrichmentStatus } from '@prisma/client';
import { WORKER_METADATA } from '@nestjs/bullmq/dist/bull.constants.js';
import { CompanyEnrichmentProcessor } from './company-enrichment.processor.js';
import { WebFetchService } from '../../enrichment/services/web-fetch.service.js';
import { SearchService } from '../../enrichment/services/search.service.js';
import { LlmService } from '../../enrichment/services/llm.service.js';

// Mirrors enrichment.processor.spec.ts's mock shape — same three injectable
// services, reused unmodified per docs/specs/target-companies.md Assumption 2.
const mockPrisma = {
  company: { findFirst: jest.fn(), update: jest.fn() },
};
const mockWebFetch = { fetchPageText: jest.fn() } satisfies Pick<
  WebFetchService,
  'fetchPageText'
>;
const mockSearch = { search: jest.fn() } satisfies Pick<
  SearchService,
  'search'
>;
const mockLlm = { extract: jest.fn() } satisfies Pick<LlmService, 'extract'>;
const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const dbCompany = {
  id: 'company-123',
  name: 'Systems Limited',
  websiteUrl: 'https://systemsltd.com',
  location: null,
};
const extracted = {
  industry: 'IT Services',
  companySize: 'Large (1000-5000)',
  techStack: ['Java', '.NET'],
  cultureSummary: 'Structured, process-driven culture.',
  workPolicy: 'Hybrid',
  workLifeBalance: 'Average',
  headquarters: 'Lahore, Pakistan',
  address: null,
  founded: '1977',
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

    expect(workerOptions).toEqual({ lockDuration: 90_000 });
  });

  let processor: CompanyEnrichmentProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new CompanyEnrichmentProcessor(
      mockPrisma as never,
      mockWebFetch as never,
      mockSearch as never,
      mockLlm as never,
      mockLogger as never,
    );
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

  it('never touches Job or CompanyProfile — only writes to Company', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockPrisma).not.toHaveProperty('job');
    expect(mockPrisma).not.toHaveProperty('companyProfile');
  });

  it('has no job-posting page to fetch — official content comes only from websiteUrl-derived pages', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    // homepage + about + contact = 3 calls; no fourth "job posting page" fetch
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledTimes(3);
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com',
    );
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com/about',
    );
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com/contact',
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
      headquarters: 'Karachi, Pakistan',
      headquartersLowConfidence: true,
      techStack: ['Python'],
    });
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      industry: null,
      headquarters: null,
      techStack: [],
    });

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          industry: 'FinTech',
          headquarters: 'Karachi, Pakistan',
          headquartersLowConfidence: true,
          techStack: ['Python'],
        }),
      }),
    );
  });

  it('keeps a low-overlap address but flags it low-confidence instead of wiping it (same guard as job enrichment)', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search
      .mockResolvedValueOnce([
        '[Contact | other-company.com] Plot 10 Block BB Canal Road Lahore',
      ])
      .mockResolvedValueOnce([]);
    mockWebFetch.fetchPageText.mockResolvedValue('We build great software.');
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      address: 'Plot 10 Block BB Canal Road Lahore',
    });

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address: 'Plot 10 Block BB Canal Road Lahore',
          addressLowConfidence: true,
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
    // No homepage/about/contact fetch without a real company domain.
    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
  });

  it('fetches the company contact page when a real domain is known, and skips /contact-us when /contact already has text', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com/contact',
    );
    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalledWith(
      'https://systemsltd.com/contact-us',
    );
  });

  it('falls back to /contact-us when /contact is empty', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/contact-us') ? 'Fallback text.' : ''),
    );
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com/contact',
    );
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://systemsltd.com/contact-us',
    );
    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('Fallback text.');
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

  it('accepts a headquarters value exactly at the 0.25 threshold boundary (not just above it)', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Located in Lahore only.');
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Lahore Nomatch Words Here',
    });

    await processor.process(bullJob);

    // "lahore" hits, the other 3 tokens don't: 1/4 = exactly 0.25. The guard
    // check is `< threshold`, so a value exactly at the bar must be accepted,
    // not flagged — pins the boundary against an accidental `<=` flip.
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Lahore Nomatch Words Here',
          headquartersLowConfidence: false,
        }),
      }),
    );
  });

  it('accepts a headquarters value in the loosened 0.25-0.7 band that the stricter address threshold would reject', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue(
      'Our office is located in Lahore, Pakistan.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Lahore Pakistan HQ Branch',
    });

    await processor.process(bullJob);

    // "lahore" and "pakistan" hit (2/4 = 0.5): >= headquarters' 0.25 bar, but
    // below address's 0.7 bar — proves the loosened threshold does real work.
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Lahore Pakistan HQ Branch',
          headquartersLowConfidence: false,
        }),
      }),
    );
  });

  it('does not let a token match inside an unrelated word pass the guard', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    // "increasing" contains the substring "inc" — exact token-Set matching
    // requires "inc" as its own standalone token, not a substring hit.
    mockWebFetch.fetchPageText.mockResolvedValue(
      'We are increasing headcount rapidly.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Springfield Inc',
    });

    await processor.process(bullJob);

    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Springfield Inc',
          headquartersLowConfidence: true,
        }),
      }),
    );
  });

  it('accepts a correct headquarters value on a state-abbreviation-vs-spelled-out-name mismatch now that the bar is lowered to 0.25', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue(
      'Located in Lahore, Punjab since 2015.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Lahore, PB, Pakistan',
    });

    await processor.process(bullJob);

    // Only "lahore" matches (1/3 ≈ 0.33) since the official text spells out
    // "Punjab" rather than "PB" — below a 0.4-style bar (would have been
    // flagged) but at/above the loosened 0.25 bar.
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Lahore, PB, Pakistan',
          headquartersLowConfidence: false,
        }),
      }),
    );
  });

  it('still flags a correct headquarters value low-confidence when overlap falls below the lowered 0.25 bar (known, accepted limitation)', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockPrisma.company.update.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue(
      'Located in Lahore, Punjab since 2015.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Lahore, PB, Pakistan Headquarters Office',
    });

    await processor.process(bullJob);

    // Only "lahore" matches out of 5 tokens (1/5 = 0.2, below the 0.25 bar) —
    // the value is still kept and shown, just flagged, not hidden.
    expect(mockPrisma.company.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Lahore, PB, Pakistan Headquarters Office',
          headquartersLowConfidence: true,
        }),
      }),
    );
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
      'company_enrichment_profile_update_failed',
      expect.objectContaining({ phase: 'mark_failed' }),
    );
  });
});
