import type { Job } from 'bullmq';
import { EnrichmentStatus } from '@prisma/client';
import { WORKER_METADATA } from '@nestjs/bullmq/dist/bull.constants.js';
import { EnrichmentProcessor } from './enrichment.processor.js';

const mockPrisma = {
  job: { findFirst: jest.fn() },
  companyProfile: { upsert: jest.fn(), update: jest.fn() },
};
const mockWebFetch = { fetchPageText: jest.fn() };
const mockSearch = { search: jest.fn() };
const mockLlm = { extract: jest.fn() };

const dbJob = { id: 'job-123', company: 'Acme Corp', url: 'https://acme.com' };
const extracted = {
  industry: 'SaaS',
  companySize: 'Small (50-200)',
  techStack: ['Python', 'Django'],
  cultureSummary: 'Great culture.',
  workPolicy: 'Remote',
  workLifeBalance: 'Excellent',
  headquarters: 'Austin, TX',
  founded: '2018',
};
const bullJob = { data: { jobId: 'job-123' } } as Job<{ jobId: string }>;

describe('EnrichmentProcessor', () => {
  it('sets a 90s lockDuration as stall-detection margin on the @Processor() worker options', () => {
    const workerOptions = Reflect.getMetadata(
      WORKER_METADATA,
      EnrichmentProcessor,
    ) as { lockDuration?: number } | undefined;

    expect(workerOptions).toEqual({ lockDuration: 90_000 });
  });

  let processor: EnrichmentProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    processor = new EnrichmentProcessor(
      mockPrisma as never,
      mockWebFetch as never,
      mockSearch as never,
      mockLlm as never,
      {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as never,
    );
  });

  it('runs the full pipeline and marks profile COMPLETED on success', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue(['culture snippet']);
    mockWebFetch.fetchPageText.mockResolvedValue('About page text.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockPrisma.companyProfile.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-123' },
        update: expect.objectContaining({
          status: EnrichmentStatus.PROCESSING,
        }),
      }),
    );
    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: 'job-123' },
        data: expect.objectContaining({
          status: EnrichmentStatus.COMPLETED,
          industry: 'SaaS',
        }),
      }),
    );
  });

  it('passes aggregated search snippets and page text to LLM', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([
      'culture snippet one',
      'tech snippet one',
    ]);
    mockWebFetch.fetchPageText.mockResolvedValue('Website content.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('culture snippet one');
    expect(context).toContain('tech snippet one');
    expect(context).toContain('Website content.');
  });

  it('passes domain and location disambiguation hints to the LLM', async () => {
    mockPrisma.job.findFirst.mockResolvedValue({
      ...dbJob,
      location: 'Austin, TX',
    });
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    const [, , disambiguation] = mockLlm.extract.mock.calls[0] as [
      string,
      string,
      { domain?: string; location?: string },
    ];
    expect(disambiguation).toEqual({
      domain: 'acme.com',
      location: 'Austin, TX',
    });
  });

  it('does not treat a job-board host as the company domain', async () => {
    mockPrisma.job.findFirst.mockResolvedValue({
      ...dbJob,
      url: 'https://pk.linkedin.com/jobs/view/12345',
    });
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    const [, , disambiguation] = mockLlm.extract.mock.calls[0] as [
      string,
      string,
      { domain?: string; location?: string },
    ];
    expect(disambiguation.domain).toBeUndefined();
    // No contact-page fetch without a real company domain — only the job URL
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledTimes(1);
  });

  it('fetches the company contact page when a real domain is known', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://acme.com/contact',
    );
    // /contact already returned text, so the /contact-us fallback is skipped
    expect(mockWebFetch.fetchPageText).not.toHaveBeenCalledWith(
      'https://acme.com/contact-us',
    );
    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('=== OFFICIAL COMPANY WEBSITE (acme.com) ===');
  });

  it('fetches the company homepage and about page when a real domain is known', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('Official text.');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith('https://acme.com');
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://acme.com/about',
    );
  });

  it('does not fetch homepage/about without a real company domain', async () => {
    mockPrisma.job.findFirst.mockResolvedValue({
      ...dbJob,
      url: 'https://pk.linkedin.com/jobs/view/12345',
    });
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).toHaveBeenCalledTimes(1);
  });

  it('places contact text ahead of homepage text when combined official content exceeds the section cap', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    const contactText = 'CONTACT_MARKER ' + 'x'.repeat(4000);
    const homepageText = 'HOMEPAGE_MARKER ' + 'y'.repeat(4000);
    mockWebFetch.fetchPageText.mockImplementation((url: string) => {
      if (url === 'https://acme.com/contact')
        return Promise.resolve(contactText);
      if (url === 'https://acme.com') return Promise.resolve(homepageText);
      return Promise.resolve('');
    });
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('CONTACT_MARKER');
    expect(context.indexOf('CONTACT_MARKER')).toBeLessThan(
      context.indexOf('HOMEPAGE_MARKER'),
    );
  });

  it('fires a domain-scoped fallback search when official content is thin', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['[acme.com] Domain-scoped snippet.']);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockSearch.search).toHaveBeenCalledTimes(2);
    const [, secondCallOptions] = mockSearch.search.mock.calls[1] as [
      string,
      { includeDomains?: string[] },
    ];
    expect(secondCallOptions).toEqual({ includeDomains: ['acme.com'] });
    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('Domain-scoped snippet.');
  });

  it('does not fire the fallback search when official content is already substantial', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('x'.repeat(400));
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockSearch.search).toHaveBeenCalledTimes(1);
  });

  it('excludes the job-posting page text from the fallback-search thinness check', async () => {
    const dbJobWithSeparatePosting = {
      ...dbJob,
      url: 'https://acme.com/careers/123',
    };
    mockPrisma.job.findFirst.mockResolvedValue(dbJobWithSeparatePosting);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['[acme.com] Domain-scoped snippet.']);
    mockWebFetch.fetchPageText.mockImplementation((url: string) =>
      Promise.resolve(
        url === 'https://acme.com/careers/123' ? 'y'.repeat(1000) : '',
      ),
    );
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    // pageText alone is 1000 chars, well over the 300-char threshold — proves
    // the fallback still fires because pageText is excluded from the check
    expect(mockSearch.search).toHaveBeenCalledTimes(2);
  });

  it('never fires the fallback search without a known company domain', async () => {
    mockPrisma.job.findFirst.mockResolvedValue({
      ...dbJob,
      url: 'https://pk.linkedin.com/jobs/view/12345',
    });
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockSearch.search).toHaveBeenCalledTimes(1);
  });

  it('falls back to /contact-us when /contact is empty', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('/contact-us') ? 'Fallback text.' : ''),
    );
    mockLlm.extract.mockResolvedValue(extracted);
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://acme.com/contact',
    );
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://acme.com/contact-us',
    );
    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('Fallback text.');
  });

  it('keeps the extracted address when it appears on the company pages', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue(
      'Visit our office: Plot 5, Main Street, Austin, TX.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      address: 'Plot 5 Main Street Austin TX',
    });
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address: 'Plot 5 Main Street Austin TX',
          addressLowConfidence: false,
        }),
      }),
    );
  });

  it('keeps a low-overlap address but flags it low-confidence instead of wiping it', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    // General search returns a same-name collision company's address; the
    // domain-scoped fallback (fired since official content below is thin)
    // returns nothing, so the address never enters trusted official content
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
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    // Kept, not wiped to "Unknown" — the guard now flags a low-confidence
    // value instead of discarding it, so the field still shows something
    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          address: 'Plot 10 Block BB Canal Road Lahore',
          addressLowConfidence: true,
        }),
      }),
    );
  });

  it('keeps a headquarters value with under 40% official-page token overlap but flags it low-confidence', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('We build great software.');
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Springfield Illinois USA',
    });
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Springfield Illinois USA',
          headquartersLowConfidence: true,
        }),
      }),
    );
  });

  it('accepts a headquarters value in the loosened 0.4-0.7 band that the stricter address threshold would reject', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue(
      'Our office is located in Austin, TX.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Austin TX USA HQ',
    });
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    // "austin" and "tx" hit (2/4 = 0.5): >= headquarters' 0.4 bar, but below
    // address's 0.7 bar — proves the loosened threshold is doing real work
    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Austin TX USA HQ',
          headquartersLowConfidence: false,
        }),
      }),
    );
  });

  it('does not let a token match inside an unrelated word pass the guard', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    // "increasing" contains the substring "inc" — the old `.includes(t)`
    // matcher would have wrongly counted "inc" as a hit here; exact
    // token-Set matching requires "inc" as its own standalone token
    mockWebFetch.fetchPageText.mockResolvedValue(
      'We are increasing headcount rapidly.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Springfield Inc',
    });
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Springfield Inc',
          headquartersLowConfidence: true,
        }),
      }),
    );
  });

  it('flags a correct headquarters value low-confidence on state-abbreviation-vs-spelled-out-name mismatch (known, accepted limitation)', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue(
      'Located in Austin, Texas since 2015.',
    );
    mockLlm.extract.mockResolvedValue({
      ...extracted,
      headquarters: 'Austin, TX, USA',
    });
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await processor.process(bullJob);

    // Only "austin" matches (1/3 ≈ 0.33, below the 0.4 threshold) since the
    // official text spells out "Texas" rather than "TX" — documented known
    // limitation, not a bug to fix in this pass. The value is still kept
    // and shown, just flagged, so this limitation now costs a spurious
    // "unverified" badge rather than hiding a correct value outright.
    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          headquarters: 'Austin, TX, USA',
          headquartersLowConfidence: true,
        }),
      }),
    );
  });

  it('returns early without touching the profile when job is not found', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    await processor.process(bullJob);

    expect(mockPrisma.companyProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.companyProfile.update).not.toHaveBeenCalled();
  });

  it('marks profile FAILED and rethrows for BullMQ retry when search throws', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('Search API down'));
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await expect(processor.process(bullJob)).rejects.toThrow('Search API down');

    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EnrichmentStatus.FAILED,
          errorMessage: 'Search API down',
        }),
      }),
    );
  });

  it('marks profile FAILED and rethrows for BullMQ retry when LLM throws', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockRejectedValue(new Error('LLM timeout'));
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await expect(processor.process(bullJob)).rejects.toThrow('LLM timeout');

    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: EnrichmentStatus.FAILED }),
      }),
    );
  });

  it('strips URLs from the error message before storing it', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(
      new Error('Failed to fetch https://api.example.com/v1/search?q=acme'),
    );
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await expect(processor.process(bullJob)).rejects.toThrow();

    const updateCall = mockPrisma.companyProfile.update.mock.calls[0][0] as {
      data: { errorMessage: string };
    };
    expect(updateCall.data.errorMessage).not.toContain('https://');
    expect(updateCall.data.errorMessage).toContain('[url]');
  });

  it('caps the error message at 200 characters', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('x'.repeat(300)));
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await expect(processor.process(bullJob)).rejects.toThrow();

    const updateCall = mockPrisma.companyProfile.update.mock.calls[0][0] as {
      data: { errorMessage: string };
    };
    expect(updateCall.data.errorMessage.length).toBeLessThanOrEqual(200);
  });

  it('throws original error even when the FAILED update itself throws', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('Search API down'));
    mockPrisma.companyProfile.update.mockRejectedValue(
      new Error('Record to update not found'),
    );

    await expect(processor.process(bullJob)).rejects.toThrow('Search API down');
  });
});
