import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { SearchService } from './search.service.js';

const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

const tavilyResponse = {
  results: [
    { content: 'Acme Corp builds great software for enterprise.' },
    { content: 'Employees rate Acme Corp 4.2 stars. Great work-life balance.' },
  ],
};

const mockConfigService = { get: jest.fn() };

describe('SearchService', () => {
  let service: SearchService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: Logger, useValue: mockLogger },
      ],
    }).compile();
    service = module.get(SearchService);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns content snippets from Tavily API results', async () => {
    mockConfigService.get.mockReturnValue('test-key');
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(tavilyResponse),
    });

    const snippets = await service.search('Acme Corp company culture');

    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toContain('Acme Corp builds great software');
    expect(snippets[1]).toContain('Great work-life balance');
  });

  it('passes the query and api_key in the POST body to Tavily', async () => {
    mockConfigService.get.mockReturnValue('my-tavily-key');
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(tavilyResponse),
    });

    await service.search('Stripe tech stack');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    const body = JSON.parse(init.body as string);
    expect(body.query).toBe('Stripe tech stack');
    expect(body.api_key).toBeUndefined();
    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer my-tavily-key',
    );
  });

  it('returns empty array when TAVILY_API_KEY is not configured', async () => {
    mockConfigService.get.mockReturnValue(undefined);

    const snippets = await service.search('Acme Corp');

    expect(snippets).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns empty array when fetch rejects', async () => {
    mockConfigService.get.mockReturnValue('test-key');
    fetchSpy.mockRejectedValue(new Error('Network error'));

    const snippets = await service.search('Acme Corp');

    expect(snippets).toEqual([]);
  });

  it('returns empty array when API response is not ok', async () => {
    mockConfigService.get.mockReturnValue('test-key');
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: 'rate limited' }),
    });

    const snippets = await service.search('Acme Corp');

    expect(snippets).toEqual([]);
  });

  it('filters out results with no content', async () => {
    mockConfigService.get.mockReturnValue('test-key');
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [{ content: 'Valid snippet' }, { content: '' }, {}],
        }),
    });

    const snippets = await service.search('Acme');

    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toBe('Valid snippet');
  });
});
