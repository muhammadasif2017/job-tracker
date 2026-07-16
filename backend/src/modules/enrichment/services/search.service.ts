import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ query, max_results: 5, include_answer: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn('tavily_search_error', { query, status: res.status });
        return [];
      }

      const data = (await res.json()) as TavilyResponse;
      const snippets = (data.results ?? [])
        .map((r) => {
          if (!r.content) return undefined;
          // Source domain in the prefix lets the LLM judge which company a
          // snippet is actually about (same-name/same-city collisions)
          const source = [r.title, this.hostnameOf(r.url)]
            .filter(Boolean)
            .join(' | ');
          return source ? `[${source}] ${r.content}` : r.content;
        })
        .filter((c): c is string => !!c);

      // Tavily's synthesized answer goes last: it is an LLM guess and, placed
      // first, dominates extraction when it describes the wrong company
      if (data.answer) snippets.push(`[Summary] ${data.answer}`);
      return snippets;
    } catch (err) {
      this.logger.warn('tavily_search_failed', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  private hostnameOf(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  }
}
