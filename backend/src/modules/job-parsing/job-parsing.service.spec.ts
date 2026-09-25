import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { JobParsingService } from './job-parsing.service.js';
import { WebFetchService } from '../enrichment/services/web-fetch.service.js';
import {
  SearchService,
  SearchUnavailableError,
} from '../enrichment/services/search.service.js';
import { LlmService } from '../enrichment/services/llm.service.js';
import {
  CircuitOpenError,
  type CircuitStatus,
} from '../../infrastructure/resilience/circuit-breaker.js';

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
  extractJobPosting: jest.fn(),
  circuitStatus: jest.fn((): CircuitStatus => CIRCUIT_CLOSED),
} satisfies Pick<LlmService, 'extractJobPosting' | 'circuitStatus'>;
const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

describe('JobParsingService', () => {
  let service: JobParsingService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockLlm.circuitStatus.mockReturnValue(CIRCUIT_CLOSED);
    const module = await Test.createTestingModule({
      providers: [
        JobParsingService,
        { provide: WebFetchService, useValue: mockWebFetch },
        { provide: SearchService, useValue: mockSearch },
        { provide: LlmService, useValue: mockLlm },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(JobParsingService);
  });

  describe('parseJobPosting while the Groq circuit is open', () => {
    it('skips the paid search fallback when extraction hit the open circuit', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('Senior Engineer at Acme');
      mockLlm.extractJobPosting.mockRejectedValue(
        new CircuitOpenError('Groq', 12_000),
      );

      const result = await service.parseJobPosting({
        url: 'https://jobs.example.com/1',
      });

      expect(result).toEqual({
        url: 'https://jobs.example.com/1',
        parserUnavailable: true,
      });
      expect(mockSearch.search).not.toHaveBeenCalled();
    });

    it('skips it too when the page gave no content but the circuit is open', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');
      mockLlm.circuitStatus.mockReturnValue({
        name: 'Groq',
        state: 'open',
        retryAfterMs: 5_000,
      });

      const result = await service.parseJobPosting({
        url: 'https://jobs.example.com/1',
      });

      expect(result).toMatchObject({ parserUnavailable: true });
      expect(mockSearch.search).not.toHaveBeenCalled();
      expect(mockLlm.extractJobPosting).not.toHaveBeenCalled();
    });

    it('still searches once the cool-down is over, since the next call is the trial', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');
      mockLlm.circuitStatus.mockReturnValue({
        name: 'Groq',
        state: 'open',
        retryAfterMs: 0,
      });
      mockSearch.search.mockResolvedValue([]);

      await service
        .parseJobPosting({ url: 'https://jobs.example.com/1' })
        .catch(() => undefined);

      expect(mockSearch.search).toHaveBeenCalledWith(
        'https://jobs.example.com/1',
      );
    });
  });

  describe('parseJobPosting', () => {
    it('fetches the URL, extracts fields, and maps the domain to an ApplicationChannel', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue(
        'Senior Engineer at Acme...',
      );
      mockLlm.extractJobPosting.mockResolvedValue({
        company: 'Acme Corp',
        position: 'Senior Engineer',
        location: 'Remote',
        jobType: 'REMOTE',
      });

      const result = await service.parseJobPosting({
        url: 'https://www.linkedin.com/jobs/view/123',
      });

      expect(mockWebFetch.fetchPageText).toHaveBeenCalledWith(
        'https://www.linkedin.com/jobs/view/123',
      );
      expect(mockLlm.extractJobPosting).toHaveBeenCalledWith(
        'Senior Engineer at Acme...',
      );
      expect(result).toEqual({
        company: 'Acme Corp',
        position: 'Senior Engineer',
        location: 'Remote',
        jobType: 'REMOTE',
        url: 'https://www.linkedin.com/jobs/view/123',
        applicationChannel: 'LINKEDIN',
      });
    });

    it('falls back to text extraction when the URL fetch fails, and still maps the domain to an ApplicationChannel', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');
      mockLlm.extractJobPosting.mockResolvedValue({
        company: 'Acme Corp',
        position: 'Senior Engineer',
      });

      const result = await service.parseJobPosting({
        url: 'https://www.indeed.com/job/1',
        text: 'pasted job description text',
      });

      expect(mockLlm.extractJobPosting).toHaveBeenCalledWith(
        'pasted job description text',
      );
      expect(result.applicationChannel).toBe('INDEED');
      expect(result.company).toBe('Acme Corp');
    });

    it('prefers client-scraped text over the server-side fetch when both are present', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue(
        'Sign in to see more jobs like this - LinkedIn',
      );
      mockLlm.extractJobPosting.mockResolvedValue({
        company: 'Acme Corp',
        position: 'Senior Engineer',
      });

      const result = await service.parseJobPosting({
        url: 'https://www.linkedin.com/jobs/view/123',
        text: 'Senior Engineer at Acme - full job description...',
      });

      expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
      expect(mockLlm.extractJobPosting).toHaveBeenCalledWith(
        'Senior Engineer at Acme - full job description...',
      );
      expect(result.company).toBe('Acme Corp');
      expect(result.applicationChannel).toBe('LINKEDIN');
    });

    it('extracts from text-only input with no URL, leaving applicationChannel and url undefined', async () => {
      mockLlm.extractJobPosting.mockResolvedValue({
        company: 'Acme Corp',
        position: 'Senior Engineer',
      });

      const result = await service.parseJobPosting({
        text: 'pasted job description text',
      });

      expect(mockWebFetch.fetchPageText).not.toHaveBeenCalled();
      expect(result.url).toBeUndefined();
      expect(result.applicationChannel).toBeUndefined();
      expect(result.company).toBe('Acme Corp');
    });

    it('throws instead of silently returning an empty result when the URL fetch yields no content and no text was pasted', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');

      await expect(
        service.parseJobPosting({ url: 'https://gated.example.com/job/1' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('returns a partial result instead of throwing when extraction fails', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');
      mockLlm.extractJobPosting.mockRejectedValue(
        new Error('Groq unavailable'),
      );

      const result = await service.parseJobPosting({
        text: 'pasted job description text',
      });

      expect(result).toEqual({ url: undefined, parserUnavailable: true });
    });

    it('does not flag the parser as unavailable when it ran but found nothing', async () => {
      mockLlm.extractJobPosting.mockResolvedValue({
        company: null,
        position: null,
        location: null,
        jobType: undefined,
      });

      const result = await service.parseJobPosting({ text: 'lorem ipsum' });

      expect(result).not.toHaveProperty('parserUnavailable');
      expect(result).toMatchObject({ company: null, position: null });
    });

    it('flags the parser as unavailable instead of throwing when the fetch was empty and extraction on the search fallback errored', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');
      mockSearch.search.mockResolvedValue(['Senior Engineer at Acme']);
      mockLlm.extractJobPosting.mockRejectedValue(
        new Error('Groq unavailable'),
      );

      const result = await service.parseJobPosting({
        url: 'https://gated.example.com/job/1',
      });

      expect(result).toEqual({
        url: 'https://gated.example.com/job/1',
        parserUnavailable: true,
      });
    });

    it('falls back to a Tavily search when LLM extraction on fetched content fails, and retries extraction on the snippets', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue(
        'Senior Engineer at Acme...',
      );
      mockLlm.extractJobPosting
        .mockRejectedValueOnce(new Error('Groq unavailable'))
        .mockResolvedValueOnce({
          company: 'Acme Corp',
          position: 'Senior Engineer',
          location: 'Remote',
          jobType: 'REMOTE',
        });
      mockSearch.search.mockResolvedValue([
        '[Acme Careers | acme.com] Senior Engineer role at Acme Corp',
      ]);

      const result = await service.parseJobPosting({
        url: 'https://www.linkedin.com/jobs/view/123',
      });

      expect(mockSearch.search).toHaveBeenCalledWith(
        'https://www.linkedin.com/jobs/view/123',
      );
      expect(mockLlm.extractJobPosting).toHaveBeenCalledTimes(2);
      expect(mockLlm.extractJobPosting).toHaveBeenNthCalledWith(
        2,
        '[Acme Careers | acme.com] Senior Engineer role at Acme Corp',
      );
      expect(result).toEqual({
        company: 'Acme Corp',
        position: 'Senior Engineer',
        location: 'Remote',
        jobType: 'REMOTE',
        url: 'https://www.linkedin.com/jobs/view/123',
        applicationChannel: 'LINKEDIN',
      });
    });

    it('returns a partial result when both the primary extraction and the Tavily fallback fail', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('some page content');
      mockLlm.extractJobPosting.mockRejectedValue(
        new Error('Groq unavailable'),
      );
      mockSearch.search.mockResolvedValue([]);

      const result = await service.parseJobPosting({
        url: 'https://www.linkedin.com/jobs/view/123',
      });

      expect(mockSearch.search).toHaveBeenCalledWith(
        'https://www.linkedin.com/jobs/view/123',
      );
      // Only the primary content attempt should reach the LLM — an empty
      // fallback snippet list must not trigger a second, pointless call.
      expect(mockLlm.extractJobPosting).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        url: 'https://www.linkedin.com/jobs/view/123',
        parserUnavailable: true,
      });
    });

    it('falls back to a partial result instead of throwing when the Tavily fallback is out of quota', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('some page content');
      mockLlm.extractJobPosting.mockRejectedValue(
        new Error('Groq unavailable'),
      );
      mockSearch.search.mockRejectedValue(
        new SearchUnavailableError('Search quota exceeded', 432),
      );

      const result = await service.parseJobPosting({
        url: 'https://www.linkedin.com/jobs/view/123',
      });

      expect(result).toEqual({
        url: 'https://www.linkedin.com/jobs/view/123',
        parserUnavailable: true,
      });
    });

    it('recovers via the Tavily fallback when the URL fetch itself yields no content', async () => {
      mockWebFetch.fetchPageText.mockResolvedValue('');
      mockSearch.search.mockResolvedValue([
        '[Example] Company info about Acme Corp',
      ]);
      mockLlm.extractJobPosting.mockResolvedValue({
        company: 'Acme Corp',
        position: 'Senior Engineer',
      });

      const result = await service.parseJobPosting({
        url: 'https://gated.example.com/job/1',
      });

      expect(mockSearch.search).toHaveBeenCalledWith(
        'https://gated.example.com/job/1',
      );
      expect(mockLlm.extractJobPosting).toHaveBeenCalledWith(
        '[Example] Company info about Acme Corp',
      );
      expect(result.company).toBe('Acme Corp');
      expect(result.applicationChannel).toBe('OTHER');
    });
  });
});
