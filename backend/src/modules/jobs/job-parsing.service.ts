import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplicationChannel } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { WebFetchService } from '../enrichment/services/web-fetch.service.js';
import {
  SearchService,
  SearchUnavailableError,
} from '../enrichment/services/search.service.js';
import {
  LlmService,
  type ParsedJobData,
} from '../enrichment/services/llm.service.js';
import { ParseJobDto } from './dto/parse-job.dto.js';
import { ParsedJobDto } from './dto/parsed-job.dto.js';

@Injectable()
export class JobParsingService {
  constructor(
    private webFetch: WebFetchService,
    private search: SearchService,
    private llm: LlmService,
    private logger: Logger,
  ) {}

  private static readonly SOURCE_DOMAINS: Array<[string, ApplicationChannel]> =
    [
      ['linkedin.com', ApplicationChannel.LINKEDIN],
      ['indeed.com', ApplicationChannel.INDEED],
      ['rozee.pk', ApplicationChannel.ROZEE],
    ];

  private guessSourceFromUrl(url: string): ApplicationChannel | undefined {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const matched = JobParsingService.SOURCE_DOMAINS.find(([domain]) =>
        host.endsWith(domain),
      );
      return matched ? matched[1] : ApplicationChannel.OTHER;
    } catch {
      return undefined;
    }
  }

  // `failed` separates "the LLM call errored" from "there was nothing to
  // extract from", which the response reports as parserUnavailable.
  private async tryExtractJobPosting(
    content: string,
  ): Promise<{ parsed?: ParsedJobData; failed: boolean }> {
    if (!content) return { failed: false };
    try {
      return {
        parsed: await this.llm.extractJobPosting(content),
        failed: false,
      };
    } catch (err: unknown) {
      this.logger.warn('parse_job_posting_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return { failed: true };
    }
  }

  async parseJobPosting(dto: ParseJobDto): Promise<ParsedJobDto> {
    // Client-scraped text (the extension pulling from the user's own,
    // possibly-logged-in tab) beats our own server-side fetch when both are
    // available. Sites like LinkedIn don't hard-block the server fetch the
    // way Indeed does - they 200 with a logged-out/paywall page, which is
    // non-empty and would otherwise win and feed the LLM junk instead of the
    // real posting already rendered in the user's browser.
    const fetchedText =
      dto.url && !dto.text ? await this.webFetch.fetchPageText(dto.url) : '';
    const content = dto.text || fetchedText || '';

    const primary = await this.tryExtractJobPosting(content);
    let parsed = primary.parsed;
    let llmFailed = primary.failed;
    let applicationChannel =
      parsed && dto.url && content
        ? this.guessSourceFromUrl(dto.url)
        : undefined;

    // Second phase: primary content was missing or extraction failed. Only
    // worth retrying when we have a URL to search for - a bare failed-text
    // extraction gives us nothing to search with.
    if (!parsed && dto.url) {
      let snippets: string[];
      try {
        snippets = (await this.search.search(dto.url)) ?? [];
      } catch (err: unknown) {
        if (!(err instanceof SearchUnavailableError)) throw err;
        this.logger.warn('parse_job_search_unavailable', {
          url: dto.url,
          error: err.message,
        });
        snippets = [];
      }
      const searchContent = snippets.filter(Boolean).join('\n\n');
      const fallback = await this.tryExtractJobPosting(searchContent);
      parsed = fallback.parsed;
      llmFailed ||= fallback.failed;
      if (parsed) {
        applicationChannel = this.guessSourceFromUrl(dto.url);
      } else if (searchContent) {
        this.logger.warn('parse_job_posting_fallback_failed', {
          url: dto.url,
        });
      }
    }

    if (!parsed) {
      // An LLM error outranks "the page was blocked": there was content (the
      // search fallback's, at least) and only the parser failed on it.
      if (llmFailed) return { url: dto.url, parserUnavailable: true };
      if (!content && dto.url) {
        throw new BadRequestException(
          'Could not fetch that page - it may be blocking automated requests. Try pasting the job description text instead.',
        );
      }
      return { url: dto.url };
    }

    return {
      company: parsed.company,
      position: parsed.position,
      location: parsed.location,
      jobType: parsed.jobType,
      url: dto.url,
      applicationChannel,
    };
  }
}
