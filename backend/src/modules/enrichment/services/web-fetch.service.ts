import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import * as dns from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { LLM_CONTEXT_BUDGET } from '../enrichment.constants.js';
import { appLogger } from '../../../infrastructure/error-tracking/app-logger.helper.js';

/**
 * Fetches a company's own web page and reduces it to plain text for the
 * enrichment prompt. Every failure path returns an empty string rather than
 * throwing: a page that cannot be read degrades a run to
 * search-snippets-only, and must not fail it.
 */
@Injectable()
export class WebFetchService {
  private readonly logger = appLogger(WebFetchService);

  /**
   * The SSRF guard. The URL being fetched ultimately comes from
   * user-supplied company data, so it is resolved and every returned
   * address checked before anything connects.
   *
   * Hostname string checks alone — a `127.` prefix match, say — cannot
   * catch a domain that merely resolves to a private, loopback or
   * link-local address (DNS rebinding), nor an IPv6 bracketed or mapped
   * literal like `[::1]` or `[::ffff:169.254.169.254]` that never matches a
   * plain-text regex. Rejecting when any resolved address is non-public
   * covers loopback, link-local including the 169.254.169.254 cloud
   * metadata endpoint, private, and IPv6 unique-local ranges, for
   * literal-IP hosts and rebinding domains alike.
   *
   * Residual gap: `fetch` re-resolves DNS on connect, so a sub-second-TTL
   * record could rebind between this check and the connection. Accepted for
   * this app's threat model — closing it needs the connection pinned to the
   * address validated here, via a custom dispatcher, which is more
   * machinery than a solo-user job tracker's enrichment pipeline warrants
   * today.
   */
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
  /**
   * A redirect target is unvalidated, so it cannot simply be followed — a
   * public URL that 302s to an internal address would bypass
   * `resolveSafeUrl` entirely. This used to be handled with `redirect:
   * 'error'`, which failed closed on any redirect at all. That turned out
   * to fail closed on most of the legitimate web: apex-to-www,
   * http-to-https and trailing-slash normalisation are all redirects, so
   * the official-site fetch threw for a large share of companies and
   * enrichment silently degraded to snippets only (ADR-037).
   *
   * Following hops manually and re-running each target through
   * `resolveSafeUrl` keeps the real security property — never connect to a
   * non-public address — while allowing ordinary redirects. This cap stops
   * a redirect loop, and a target that fails validation aborts the fetch
   * rather than falling through to the next hop.
   */
  private static readonly MAX_REDIRECTS = 3;

  /**
   * Fetches one page and returns its readable text, truncated to the
   * context budget. Returns an empty string for anything that did not work
   * out: an unsafe or unparseable URL, a redirect chain that is too long or
   * leads somewhere unsafe, a non-2xx response, a timeout.
   */
  async fetchPageText(url: string): Promise<string> {
    if (!url) return '';
    let safeUrl = await this.resolveSafeUrl(url);
    if (!safeUrl) return '';

    try {
      // One budget for the whole redirect chain, not one per hop. Created
      // before the first fetch, so the clock covers every hop that follows:
      // a chain still resolving at t=10s aborts, even mid-hop. That is the
      // point — per-hop timeouts would let 1 + MAX_REDIRECTS hops run 40s,
      // and CompanyEnrichmentProcessor makes several fetchPageText calls per
      // run, so a slow-redirecting host could stretch every enrichment run
      // (and its Tavily/Groq-holding worker slot) by that much. Don't move
      // this inside the loop to "give each hop a fair chance".
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
          this.logger.warn(
            {
              url,
              status: res.status,
            },
            'web_fetch_redirect_no_location',
          );
          return '';
        }

        // Resolved against the URL that issued it, so a relative Location
        // ("/about") works the same as an absolute one.
        const next = await this.resolveSafeUrl(
          new URL(location, safeUrl).toString(),
        );
        if (!next) {
          this.logger.warn(
            {
              url,
              status: res.status,
            },
            'web_fetch_unsafe_redirect',
          );
          return '';
        }

        safeUrl = next;
        res = await fetch(safeUrl, init);
      }

      if (this.isRedirect(res.status)) {
        this.logger.warn({ url }, 'web_fetch_too_many_redirects');
        return '';
      }
      if (!res.ok) {
        this.logger.warn({ url, status: res.status }, 'web_fetch_error');
        return '';
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      // Site chrome is stripped before text extraction because it competes
      // for the same budget as real content. Measured on systemsltd.com:
      // whole-<body> text is 12883 characters, of which 6794 is the
      // navigation menu, and the page's own positioning prose starts only
      // after ~700 characters of "Skip to main content / Main navigation /
      // Services / Digital / ...". Since each page is truncated to
      // LLM_CONTEXT_BUDGET, that boilerplate crowds the front of the context
      // *and* pushes real content past the cut. `header` is included: on
      // innovation-insight.com the entire nav lives inside <header>, and no
      // measured site lost hero copy to removing it. See ADR-039.
      $('script, style, noscript, nav, header, footer, aside, form').remove();

      // Prefer the page's own content landmark when it declares one. Many
      // marketing sites declare neither, so the stripped <body> is a normal
      // fallback here, not an error case.
      const scoped =
        $('main').text() || $('article').text() || $('body').text();
      let text = scoped.replace(/\s+/g, ' ').trim();

      // Pathological markup - a page nesting everything inside <header>,
      // say - strips down to nothing. Only an empty result triggers this:
      // comparing lengths instead would always prefer the un-stripped text,
      // since boilerplate makes it longer by construction, which is the
      // opposite of what the strip above is for.
      if (!text) {
        const $unstripped = cheerio.load(html);
        $unstripped('script, style, noscript').remove();
        text = $unstripped('body').text().replace(/\s+/g, ' ').trim();
      }

      return text.slice(0, LLM_CONTEXT_BUDGET);
    } catch (err) {
      this.logger.warn(
        {
          url,
          err,
        },
        'web_fetch_failed',
      );
      return '';
    }
  }

  /**
   * 304 and 305 carry a Location in some servers' responses but are not
   * redirects to follow; the fetch spec's redirect statuses are exactly
   * these.
   */
  private isRedirect(status: number): boolean {
    return [301, 302, 303, 307, 308].includes(status);
  }
}
