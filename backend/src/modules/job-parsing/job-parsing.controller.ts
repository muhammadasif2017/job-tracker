import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JobParsingService } from './job-parsing.service.js';
import { ParseJobDto } from './dto/parse-job.dto.js';
import { ParsedJobDto } from './dto/parsed-job.dto.js';
import { PatAccessible } from '../../common/decorators/pat-accessible.decorator.js';

/**
 * Quick Add's posting parser. Mounted under the `jobs` prefix like
 * `JobsController`, but kept in its own module so the jobs core does not
 * depend on the enrichment services this is the only consumer of.
 *
 * `parse` is a fixed segment and every POST route on `JobsController` is
 * either fixed or prefixed by `:id`, so there is no parameterised sibling
 * that could capture it and no registration-order constraint here — unlike
 * the GET routes documented on `JobsController`.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class JobParsingController {
  constructor(private jobParsing: JobParsingService) {}

  @Post('parse')
  @PatAccessible()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Extract job fields from a posting URL or pasted text, for quick-add prefill',
  })
  /**
   * Parses a job posting into form fields for Quick Add. Throttled harder
   * than the global limit: each call is a page fetch, a web search and a
   * model round trip — real external cost, and, together with the SSRF
   * hardening in `WebFetchService`, a request path that should not be
   * hammerable.
   */
  @ApiOkResponse({ type: ParsedJobDto })
  parseJobPosting(@Body() dto: ParseJobDto) {
    if (!dto.url && !dto.text) {
      throw new BadRequestException('Either url or text must be provided');
    }
    return this.jobParsing.parseJobPosting(dto);
  }
}
