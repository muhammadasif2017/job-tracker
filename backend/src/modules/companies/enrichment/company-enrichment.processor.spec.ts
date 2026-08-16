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
    mockWebFetch.fetchPageText.mockResolvedValue('');
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
    mockSearch.search.mockResolvedValue([]);
    mockLlm.extract.mockResolvedValue(extracted);

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
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
    mockWebFetch.fetchPageText.mockResolvedValue('');
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

  it('salvages extracted data on a late failure (write succeeds, later step throws) and does not rethrow', async () => {
    mockPrisma.company.findFirst.mockResolvedValue(dbCompany);
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
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
    mockWebFetch.fetchPageText.mockResolvedValue('');
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
    mockWebFetch.fetchPageText.mockResolvedValue('');
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
});
