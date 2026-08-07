import { BadRequestException, Injectable } from '@nestjs/common';
import { ApplicationChannel } from '@prisma/client';
import { Logger } from 'nestjs-pino';
import { WebFetchService } from '../enrichment/services/web-fetch.service.js';
import { SearchService } from '../enrichment/services/search.service.js';
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

  private async tryExtractJobPosting(
    content: string,
  ): Promise<ParsedJobData | undefined> {
    if (!content) return undefined;
    try {
      return await this.llm.extractJobPosting(content);
    } catch (err: unknown) {
      this.logger.warn('parse_job_posting_failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  async parseJobPosting(dto: ParseJobDto): Promise<ParsedJobDto> {
    const fetchedText = dto.url
      ? await this.webFetch.fetchPageText(dto.url)
      : '';
    const content = fetchedText || dto.text || '';

    let parsed = await this.tryExtractJobPosting(content);
    let applicationChannel =
      parsed && dto.url && fetchedText
        ? this.guessSourceFromUrl(dto.url)
        : undefined;

    // Second phase: primary content was missing or extraction failed. Only
    // worth retrying when we have a URL to search for - a bare failed-text
    // extraction gives us nothing to search with.
    if (!parsed && dto.url) {
      const snippets = (await this.search.search(dto.url)) ?? [];
      const searchContent = snippets.filter(Boolean).join('\n\n');
      parsed = await this.tryExtractJobPosting(searchContent);
      if (parsed) {
        applicationChannel = this.guessSourceFromUrl(dto.url);
      } else if (searchContent) {
        this.logger.warn('parse_job_posting_fallback_failed', {
          url: dto.url,
        });
      }
    }

    if (!parsed) {
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
