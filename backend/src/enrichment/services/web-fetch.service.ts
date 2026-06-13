import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { Logger } from 'nestjs-pino';
import { LLM_CONTEXT_BUDGET } from '../enrichment.constants.js';

@Injectable()
export class WebFetchService {
  constructor(private readonly logger: Logger) {}

  private isSafeUrl(url: string): boolean {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) return false;
      const h = u.hostname;
      // Block localhost, loopback, and RFC-1918 / link-local private ranges
      if (
        /^(localhost|127\.|0\.0\.0\.0|::1)/.test(h) ||
        /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h)
      )
        return false;
      return true;
    } catch {
      return false;
    }
  }

  async fetchPageText(url: string): Promise<string> {
    if (!url || !this.isSafeUrl(url)) return '';

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobTrackerBot/1.0)',
        },
        signal: AbortSignal.timeout(10_000),
      });
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
}
