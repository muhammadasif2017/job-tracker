import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  content?: string;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

@Injectable()
export class SearchService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  async search(query: string): Promise<string[]> {
    const apiKey = this.config.get<string>('TAVILY_API_KEY');
    if (!apiKey) return [];

    try {
      const res = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey, query, max_results: 5 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn('tavily_search_error', { query, status: res.status });
        return [];
      }

      const data: TavilyResponse = await res.json();
      return (data.results ?? [])
        .map((r) => r.content)
        .filter((c): c is string => !!c);
    } catch (err) {
      this.logger.warn('tavily_search_failed', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}
