import { Test } from '@nestjs/testing';
import { WebFetchService } from './web-fetch.service.js';

const htmlPage = `
<html>
  <head>
    <title>Acme Corp</title>
    <style>body { color: red; }</style>
    <script>alert('hi')</script>
  </head>
  <body>
    <nav>Nav links</nav>
    <p>We build great software.</p>
    <p>Our team is fully remote.</p>
    <script>console.log('inline')</script>
  </body>
</html>`;

describe('WebFetchService', () => {
  let service: WebFetchService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [WebFetchService],
    }).compile();
    service = module.get(WebFetchService);
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  it('returns plain text with HTML tags stripped', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(htmlPage),
    });

    const result = await service.fetchPageText('https://acme.com');

    expect(result).toContain('We build great software.');
    expect(result).toContain('Our team is fully remote.');
    expect(result).not.toContain('<p>');
    expect(result).not.toContain('alert(');
    expect(result).not.toContain('color: red');
  });

  it('returns empty string when fetch rejects (network error)', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.fetchPageText('https://unreachable.example');

    expect(result).toBe('');
  });

  it('returns empty string when response is not ok', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    const result = await service.fetchPageText('https://acme.com/missing');

    expect(result).toBe('');
  });

  it('truncates output to 8000 characters', async () => {
    const bigHtml = `<html><body>${'<p>x</p>'.repeat(5000)}</body></html>`;
    fetchSpy.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(bigHtml),
    });

    const result = await service.fetchPageText('https://acme.com');

    expect(result.length).toBeLessThanOrEqual(8000);
  });
});
