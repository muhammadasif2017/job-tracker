import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';

const MAX_TEXT_LENGTH = 8000;

@Injectable()
export class WebFetchService {
  async fetchPageText(url: string): Promise<string> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; JobTrackerBot/1.0)',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return '';

      const html = await res.text();
      const $ = cheerio.load(html);
      $('script, style, noscript').remove();

      const text = $('body').text().replace(/\s+/g, ' ').trim();
      return text.slice(0, MAX_TEXT_LENGTH);
    } catch {
      return '';
    }
  }
}
