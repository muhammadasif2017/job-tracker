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
      { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
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

  it('returns early without touching the profile when job is not found', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(null);

    await processor.process(bullJob);

    expect(mockPrisma.companyProfile.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.companyProfile.update).not.toHaveBeenCalled();
  });

  it('marks profile FAILED and does not rethrow when search throws', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('Search API down'));
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await expect(processor.process(bullJob)).resolves.toBeUndefined();

    expect(mockPrisma.companyProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: EnrichmentStatus.FAILED,
          errorMessage: 'Search API down',
        }),
      }),
    );
  });

  it('marks profile FAILED and does not rethrow when LLM throws', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockResolvedValue([]);
    mockWebFetch.fetchPageText.mockResolvedValue('');
    mockLlm.extract.mockRejectedValue(new Error('LLM timeout'));
    mockPrisma.companyProfile.update.mockResolvedValue({});

    await expect(processor.process(bullJob)).resolves.toBeUndefined();

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

    await processor.process(bullJob);

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

    await processor.process(bullJob);

    const updateCall = mockPrisma.companyProfile.update.mock.calls[0][0] as {
      data: { errorMessage: string };
    };
    expect(updateCall.data.errorMessage.length).toBeLessThanOrEqual(200);
  });

  it('does not rethrow when the FAILED update itself throws (profile deleted mid-flight)', async () => {
    mockPrisma.job.findFirst.mockResolvedValue(dbJob);
    mockPrisma.companyProfile.upsert.mockResolvedValue({});
    mockSearch.search.mockRejectedValue(new Error('Search API down'));
    mockPrisma.companyProfile.update.mockRejectedValue(
      new Error('Record to update not found'),
    );

    await expect(processor.process(bullJob)).resolves.toBeUndefined();
  });
});
