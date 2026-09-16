import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';

const TAVILY_SEARCH_URL = 'https://api.tavily.com/search';

/**
 * Thrown only for account-level Tavily failures — quota exhausted, bad key
 * — the kind of error a caller needs the real reason for, as opposed to a
 * transient network or 5xx blip that is fine to degrade silently to an
 * empty result. Callers that do not care, such as Quick Add's best-effort
 * fallback search, swallow this the same as any other search failure.
 */
export class SearchUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SearchUnavailableError';
  }
}

/**
 * One hit from Tavily. Every field is optional because the API omits rather
 * than nulls, and a result with no content is not usable here.
 */
interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

/**
 * The slice of Tavily's response this app reads: the hits, plus the
 * synthesized answer when one was requested.
 */
interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

/**
 * Web search behind company enrichment. Degrades to an empty result rather
 * than failing whenever it can — with no `TAVILY_API_KEY` configured every
 * search returns nothing and the app still works, minus enrichment.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly config: ConfigService,
    private readonly logger: Logger,
  ) {}

  /**
   * Runs one search and returns ranked snippets ready to hand to the model.
   *
   * Only account-level failures throw. Everything else — no API key, a
   * timeout, a 5xx — comes back as an empty array, because a missing
   * snippet degrades an enrichment run while a thrown error would fail it.
   */
  async search(
    query: string,
    options?: { includeDomains?: string[] },
  ): Promise<string[]> {
    const apiKey = this.config.get<string>('TAVILY_API_KEY');
    if (!apiKey) return [];

    try {
      const res = await fetch(TAVILY_SEARCH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query,
          max_results: 5,
          include_answer: true,
          ...(options?.includeDomains
            ? { include_domains: options.includeDomains }
            : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.warn('tavily_search_error', { query, status: res.status });
        // 429/432: Tavily's rate-limit and monthly-quota-exceeded statuses.
        // Worded to match the frontend's RATE_LIMITED classifier regardless
        // of which of the two Tavily actually sends.
        if (res.status === 429 || res.status === 432) {
          throw new SearchUnavailableError(
            `Search quota exceeded (Tavily returned ${res.status}) — rate limit reached for this billing period; resets automatically.`,
            res.status,
          );
        }
        // 401/403: bad/revoked key — a real config problem, not a transient
        // blip. Worded to match the frontend's CONFIG classifier.
        if (res.status === 401 || res.status === 403) {
          throw new SearchUnavailableError(
            `Search provider rejected the request (Tavily returned ${res.status}): unauthorized — check TAVILY_API_KEY.`,
            res.status,
          );
        }
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
      if (err instanceof SearchUnavailableError) throw err;
      this.logger.warn('tavily_search_failed', {
        query,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Reduces a result URL to a bare domain for the snippet prefix. Returns
   * nothing for a URL that will not parse, so a malformed result loses its
   * attribution rather than the whole search failing.
   */
  private hostnameOf(url?: string): string | undefined {
    if (!url) return undefined;
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return undefined;
    }
  }
}
