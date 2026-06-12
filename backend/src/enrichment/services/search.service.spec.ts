import { Test } from '@nestjs/testing';
import { SearchService } from './search.service.js';

const braveResponse = {
  web: {
    results: [
      {
        title: 'Acme Corp - About',
        url: 'https://acme.com/about',
        description: 'Acme Corp builds great software for enterprise.',
      },
      {
        title: 'Acme Corp Reviews | Glassdoor',
        url: 'https://glassdoor.com/acme',
        description:
          'Employees rate Acme Corp 4.2 stars. Great work-life balance.',
      },
    ],
  },
};

describe('SearchService', () => {
  let service: SearchService;
  let fetchSpy: jest.SpyInstance;
  const originalKey = process.env.BRAVE_SEARCH_API_KEY;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [SearchService],
    }).compile();
    service = module.get(SearchService);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env.BRAVE_SEARCH_API_KEY = originalKey;
  });

  it('returns description snippets from Brave API results', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(braveResponse),
    });

    const snippets = await service.search('Acme Corp company culture');

    expect(snippets).toHaveLength(2);
    expect(snippets[0]).toContain('Acme Corp builds great software');
    expect(snippets[1]).toContain('Great work-life balance');
  });

  it('passes the query and auth header to Brave API', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'my-brave-key';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(braveResponse),
    });

    await service.search('Stripe tech stack');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('Stripe+tech+stack');
    expect(
      (init.headers as Record<string, string>)['X-Subscription-Token'],
    ).toBe('my-brave-key');
  });

  it('returns empty array when BRAVE_SEARCH_API_KEY is not set', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY;

    const snippets = await service.search('Acme Corp');

    expect(snippets).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns empty array when fetch rejects', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    fetchSpy.mockRejectedValue(new Error('Network error'));

    const snippets = await service.search('Acme Corp');

    expect(snippets).toEqual([]);
  });

  it('returns empty array when API response is not ok', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve({ error: 'rate limited' }),
    });

    const snippets = await service.search('Acme Corp');

    expect(snippets).toEqual([]);
  });

  it('filters out results with no description', async () => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key';
    fetchSpy.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          web: {
            results: [
              {
                title: 'A',
                url: 'https://a.com',
                description: 'Valid snippet',
              },
              { title: 'B', url: 'https://b.com' },
            ],
          },
        }),
    });

    const snippets = await service.search('Acme');

    expect(snippets).toHaveLength(1);
    expect(snippets[0]).toBe('Valid snippet');
  });
});
