import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search';

interface BraveResult {
  title: string;
  url: string;
  description?: string;
}

interface BraveResponse {
  web?: { results: BraveResult[] };
}

@Injectable()
export class SearchService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  async search(query: string): Promise<string[]> {
    const apiKey = this.config.get<string>('BRAVE_SEARCH_API_KEY');
    if (!apiKey) return [];

    try {
      const params = new URLSearchParams({ q: query, count: '5' });
      const res = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
        headers: {
          'X-Subscription-Token': apiKey,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn('brave_search_error', { query, status: res.status });
        return [];
      }

      const data: BraveResponse = await res.json();
      return (data.web?.results ?? [])
        .filter((r) => !!r.description)
        .map((r) => r.description as string);
    } catch (err) {
      this.logger.warn('brave_search_failed', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
