import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
// Node's dns/promises exports are non-configurable, so jest.spyOn can't
// redefine `lookup` directly — mock the whole module at the factory level
// instead, which intercepts resolution before either this file or the
// service under test gets a real handle on it.
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
import * as dns from 'node:dns/promises';
import { WebFetchService } from './web-fetch.service.js';

const dnsLookup = dns.lookup as jest.Mock;
const mockLogger = { warn: jest.fn(), log: jest.fn(), error: jest.fn() };

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

function mockDnsAddresses(
  ...addresses: Array<{ address: string; family: number }>
) {
  dnsLookup.mockResolvedValue(addresses);
}

describe('WebFetchService', () => {
  let service: WebFetchService;
  let fetchSpy: jest.SpyInstance;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [WebFetchService, { provide: Logger, useValue: mockLogger }],
    }).compile();
    service = module.get(WebFetchService);
    fetchSpy = jest.spyOn(global, 'fetch');
    dnsLookup.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns plain text with HTML tags stripped', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
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
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await service.fetchPageText('https://unreachable.example');

    expect(result).toBe('');
  });

  it('returns empty string when response is not ok', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('Not Found'),
    });

    const result = await service.fetchPageText('https://acme.com/missing');

    expect(result).toBe('');
  });

  it('truncates output to 8000 characters', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    const bigHtml = `<html><body>${'<p>x</p>'.repeat(5000)}</body></html>`;
    fetchSpy.mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(bigHtml),
    });

    const result = await service.fetchPageText('https://acme.com');

    expect(result.length).toBeLessThanOrEqual(8000);
  });

  it('returns empty string for an empty url without calling fetch', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });

    const result = await service.fetchPageText('');

    expect(result).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(dnsLookup).not.toHaveBeenCalled();
  });

  it('returns empty string when DNS lookup fails', async () => {
    dnsLookup.mockRejectedValue(new Error('ENOTFOUND'));

    const result = await service.fetchPageText(
      'https://does-not-exist.invalid',
    );

    expect(result).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // Redirects are followed by hand rather than by fetch, so that each hop's
  // target goes back through resolveSafeUrl. `redirect: 'manual'` is what
  // hands us the 3xx instead of letting undici act on it. See ADR-037.
  const redirectTo = (location: string, status = 307) => ({
    status,
    ok: false,
    headers: { get: (h: string) => (h === 'location' ? location : null) },
  });
  const pageOk = (body = '<html><body>ok</body></html>') => ({
    status: 200,
    ok: true,
    text: () => Promise.resolve(body),
  });

  it('sends redirect: "manual" rather than letting fetch follow unvalidated hops', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    fetchSpy.mockResolvedValue(pageOk());

    await service.fetchPageText('https://acme.com');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  // The regression this fix exists for: apex-to-www is a redirect, so
  // `redirect: 'error'` made ordinary company sites throw "fetch failed" and
  // enrichment fell back to search snippets alone.
  it('follows an apex-to-www redirect and returns the final page text', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    fetchSpy
      .mockResolvedValueOnce(redirectTo('https://www.acme.com/'))
      .mockResolvedValueOnce(
        pageOk('<html><body>We build things.</body></html>'),
      );

    const text = await service.fetchPageText('https://acme.com');

    expect(text).toBe('We build things.');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[1][0] as URL).toString()).toBe(
      'https://www.acme.com/',
    );
  });

  it('resolves a relative Location against the URL that issued it', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    fetchSpy
      .mockResolvedValueOnce(redirectTo('/about-us', 301))
      .mockResolvedValueOnce(pageOk());

    await service.fetchPageText('https://acme.com/about');

    expect((fetchSpy.mock.calls[1][0] as URL).toString()).toBe(
      'https://acme.com/about-us',
    );
  });

  // The security property the old `redirect: 'error'` was protecting, kept
  // intact: a public URL that redirects to an internal address must not be
  // followed.
  it('refuses a redirect whose target resolves to a private address', async () => {
    dnsLookup
      .mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }])
      .mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    fetchSpy.mockResolvedValueOnce(
      redirectTo('http://169.254.169.254/latest/meta-data/'),
    );

    const text = await service.fetchPageText('https://acme.com');

    expect(text).toBe('');
    // Only the first hop was ever fetched — the metadata endpoint was not.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'web_fetch_unsafe_redirect',
      expect.objectContaining({ url: 'https://acme.com' }),
    );
  });

  it('gives up on a redirect loop instead of following it forever', async () => {
    mockDnsAddresses({ address: '93.184.216.34', family: 4 });
    fetchSpy.mockResolvedValue(redirectTo('https://acme.com/loop'));

    const text = await service.fetchPageText('https://acme.com');

    expect(text).toBe('');
    // Initial request plus MAX_REDIRECTS hops, then it stops.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'web_fetch_too_many_redirects',
      expect.objectContaining({ url: 'https://acme.com' }),
    );
  });

  describe('SSRF protection', () => {
    it('blocks non-http(s) protocols without a DNS lookup', async () => {
      mockDnsAddresses({ address: '93.184.216.34', family: 4 });

      const result = await service.fetchPageText('ftp://acme.com/file');

      expect(result).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(dnsLookup).not.toHaveBeenCalled();
    });

    it.each([
      ['http://localhost/admin', '127.0.0.1', 4],
      ['http://127.0.0.1/etc/passwd', '127.0.0.1', 4],
      ['http://0.0.0.0', '0.0.0.0', 4],
      ['http://10.0.0.1/metadata', '10.0.0.1', 4],
      ['http://192.168.1.1/router', '192.168.1.1', 4],
      ['http://172.16.0.1/internal', '172.16.0.1', 4],
      ['http://169.254.169.254/latest/meta-data/', '169.254.169.254', 4],
      ['http://[::1]/', '::1', 6],
      ['http://[::ffff:169.254.169.254]/', '::ffff:169.254.169.254', 6],
    ])(
      'blocks %s when it resolves to %s (a private/loopback/link-local address)',
      async (url, address, family) => {
        mockDnsAddresses({ address, family });

        const result = await service.fetchPageText(url);

        expect(result).toBe('');
        expect(fetchSpy).not.toHaveBeenCalled();
      },
    );

    it('blocks DNS rebinding — a normal-looking hostname that resolves to a private IP', async () => {
      mockDnsAddresses({ address: '169.254.169.254', family: 4 });

      const result = await service.fetchPageText(
        'http://looks-legit.attacker.example/',
      );

      expect(result).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('blocks when only one of several resolved addresses is private', async () => {
      mockDnsAddresses(
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      );

      const result = await service.fetchPageText('http://multi-homed.example/');

      expect(result).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
