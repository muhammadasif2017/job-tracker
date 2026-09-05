import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import * as dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Logger } from 'nestjs-pino';
import { LLM_CONTEXT_BUDGET } from '../enrichment.constants.js';

@Injectable()
export class WebFetchService {
  constructor(private readonly logger: Logger) {}

  // Hostname-string checks alone (e.g. a "127." prefix match) can't catch a
  // domain that merely *resolves* to a private/loopback/link-local address
  // (DNS rebinding), or an IPv6-bracketed/mapped literal like "[::1]" or
  // "[::ffff:169.254.169.254]" that never matches a plain-text regex. This
  // resolves the hostname and rejects if ANY returned address is
  // non-public — covers loopback, link-local (incl. the 169.254.169.254
  // cloud metadata endpoint), private, and IPv6 unique-local ranges for both
  // literal-IP hosts and rebinding domains alike.
  //
  // Residual gap: `fetch` below re-resolves DNS on connect, so a
  // sub-second-TTL record could theoretically rebind between this check and
  // the actual connection (TOCTOU). Accepted for this app's threat model —
  // closing it fully needs pinning the connection to the address validated
  // here (a custom dispatcher/agent), which is more machinery than a
  // solo-user job tracker's enrichment pipeline warrants today.
  private async resolveSafeUrl(url: string): Promise<URL | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!['http:', 'https:'].includes(u.protocol)) return null;

    // dns.lookup expects a bare literal/hostname — strip IPv6 brackets.
    const host = u.hostname.replace(/^\[|\]$/g, '');

    let records: { address: string; family: number }[];
    try {
      records = await dns.lookup(host, { all: true });
    } catch {
      return null;
    }
    if (records.length === 0) return null;

    for (const { address } of records) {
      // ipaddr.process() collapses IPv4-mapped IPv6 (::ffff:x.x.x.x) down to
      // its embedded IPv4 form before ranging it, so that bypass class is
      // covered too.
      if (ipaddr.process(address).range() !== 'unicast') return null;
    }

    return u;
  }

  // A redirect target is unvalidated, so it can't simply be followed — a
  // public URL that 302s to an internal address would bypass resolveSafeUrl
  // entirely. This used to be handled with `redirect: 'error'`, which failed
  // closed on *any* redirect. That turned out to fail closed on most of the
  // legitimate web: apex-to-www (codenzy.com 307s to www.codenzy.com),
  // http-to-https, and trailing-slash normalisation are all redirects, so the
  // official-site fetch threw "fetch failed" for a large share of companies
  // and enrichment silently degraded to search-snippets-only. See ADR-037.
  //
  // Following hops manually and re-running each target through
  // resolveSafeUrl keeps the actual security property — we never connect to a
  // non-public address — while allowing ordinary redirects. The hop cap stops
  // a redirect loop, and a target that fails validation aborts the fetch
  // rather than falling through to the next hop.
  private static readonly MAX_REDIRECTS = 3;

  async fetchPageText(url: string): Promise<string> {
    if (!url) return '';
    let safeUrl = await this.resolveSafeUrl(url);
    if (!safeUrl) return '';

    try {
      // One budget for the whole redirect chain, not one per hop. Created
      // before the first fetch, so the clock covers every hop that follows:
      // a chain still resolving at t=10s aborts, even mid-hop. That is the
      // point — per-hop timeouts would let 1 + MAX_REDIRECTS hops run 40s,
      // and CompanyEnrichmentProcessor makes up to four fetchPageText calls
      // (three parallel, then /contact-us) inside a 90s BullMQ lockDuration,
      // which a slow-redirecting host could otherwise blow through. Don't
      // move this inside the loop to "give each hop a fair chance".
      const signal = AbortSignal.timeout(10_000);
      const init: RequestInit = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobTrackerBot/1.0)',
        },
        signal,
        redirect: 'manual',
      };

      let res = await fetch(safeUrl, init);

      for (
        let hop = 0;
        this.isRedirect(res.status) && hop < WebFetchService.MAX_REDIRECTS;
        hop++
      ) {
        // A 3xx with no Location is malformed, not a hop we ran out of budget
        // for — returning here keeps it out of the too-many-redirects branch
        // below, which would otherwise mislabel it during triage.
        const location = res.headers.get('location');
        if (!location) {
          this.logger.warn('web_fetch_redirect_no_location', {
            url,
            status: res.status,
          });
          return '';
        }

        // Resolved against the URL that issued it, so a relative Location
        // ("/about") works the same as an absolute one.
        const next = await this.resolveSafeUrl(
          new URL(location, safeUrl).toString(),
        );
        if (!next) {
          this.logger.warn('web_fetch_unsafe_redirect', {
            url,
            status: res.status,
          });
          return '';
        }

        safeUrl = next;
        res = await fetch(safeUrl, init);
      }

      if (this.isRedirect(res.status)) {
        this.logger.warn('web_fetch_too_many_redirects', { url });
        return '';
      }
      if (!res.ok) {
        this.logger.warn('web_fetch_error', { url, status: res.status });
        return '';
      }

      const html = await res.text();
      const $ = cheerio.load(html);
      $('script, style, noscript').remove();

      const text = $('body').text().replace(/\s+/g, ' ').trim();
      return text.slice(0, LLM_CONTEXT_BUDGET);
    } catch (err) {
      this.logger.warn('web_fetch_failed', {
        url,
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  // 304 and 305 carry a Location in some servers' responses but aren't
  // redirects to follow; the fetch spec's redirect statuses are exactly these.
  private isRedirect(status: number): boolean {
    return [301, 302, 303, 307, 308].includes(status);
  }
}
