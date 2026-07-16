import type { Job } from 'bullmq';
import { EnrichmentStatus } from '@prisma/client';
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
  remotePolicy: 'Remote',
  workLifeBalance: 'Excellent',
  headquarters: 'Austin, TX',
  founded: '2018',
};
const bullJob = { data: { jobId: 'job-123' } } as Job<{ jobId: string }>;

describe('EnrichmentProcessor', () => {
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
    mockSearch.search
      .mockResolvedValueOnce(['culture snippet one'])
      .mockResolvedValueOnce(['tech snippet one']);
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

  it('fetches the company contact pages when a real domain is known', async () => {
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
    expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
      'https://acme.com/contact-us',
    );
    const [, context] = mockLlm.extract.mock.calls[0] as [string, string];
    expect(context).toContain('=== OFFICIAL COMPANY WEBSITE (acme.com) ===');
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
