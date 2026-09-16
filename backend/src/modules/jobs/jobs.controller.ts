import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { JobsStatsService } from './jobs-stats.service.js';
import { JobParsingService } from './job-parsing.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { ParseJobDto } from './dto/parse-job.dto.js';
import { ParsedJobDto } from './dto/parsed-job.dto.js';
import { JobResponseDto } from './dto/job-response.dto.js';
import { PaginatedJobsDto } from './dto/paginated-jobs.dto.js';
import { PaginatedJobEventsDto } from './dto/paginated-job-events.dto.js';
import { JobEventsQueryDto } from './dto/job-events-query.dto.js';
import { JobStatsDto } from './dto/job-stats.dto.js';
import { FunnelStatsDto } from './dto/funnel-stats.dto.js';
import { TrendStatsDto } from './dto/trend-stats.dto.js';
import { StatsQueryDto } from './dto/stats-query.dto.js';
import { AttentionItemDto } from './dto/attention-item.dto.js';
import { GhostSuggestionDto } from './dto/ghost-suggestion.dto.js';
import {
  MarkGhostedDto,
  MarkGhostedResultDto,
} from './dto/mark-ghosted.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { PatAccessible } from '../../common/decorators/pat-accessible.decorator.js';

/**
 * Everything about a user's job applications: the list and detail views,
 * the dashboard aggregates, CSV export, the ghost-suggestion actions and
 * Quick Add's posting parser.
 *
 * Every literal route — `stats`, `stats/funnel`, `stats/trend`, `export`,
 * `attention`, `ghost-suggestions` — must stay above `:id`. A fixed segment
 * only wins over a parameterized one when it is registered first.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class JobsController {
  constructor(
    private jobsService: JobsService,
    private jobsStats: JobsStatsService,
    private jobParsing: JobParsingService,
  ) {}

  /** Creates a job application. */
  @Post()
  @PatAccessible()
  @ApiOperation({ summary: 'Create a job application' })
  @ApiCreatedResponse({ type: JobResponseDto })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user.id, dto);
  }

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

  @Get()
  @ApiOperation({
    summary: 'List job applications with filters and pagination',
  })
  /**
   * Lists the user's jobs with the list view's filters, search, sort and
   * pagination.
   */
  @ApiOkResponse({ type: PaginatedJobsDto })
  findAll(@CurrentUser() user: { id: string }, @Query() query: JobQueryDto) {
    return this.jobsService.findAll(user.id, query);
  }

  /** The dashboard's headline numbers. */
  @Get('stats')
  @ApiOperation({ summary: 'Get application funnel stats' })
  @ApiOkResponse({ type: JobStatsDto })
  getStats(@CurrentUser() user: { id: string }, @Query() query: StatsQueryDto) {
    return this.jobsStats.getStats(user.id, query.range ?? 'all');
  }

  @Get('stats/funnel')
  @ApiOperation({
    summary:
      'Get funnel conversion, dropoff, avg time-in-stage, and response rate by application channel',
  })
  /** The application funnel and its per-source breakdowns. */
  @ApiOkResponse({ type: FunnelStatsDto })
  getFunnel(
    @CurrentUser() user: { id: string },
    @Query() query: StatsQueryDto,
  ) {
    return this.jobsStats.getFunnel(user.id, query.range ?? 'all');
  }

  @Get('stats/trend')
  @ApiOperation({
    summary:
      'Get application volume over time (adaptive day/week/month buckets + cumulative total)',
  })
  /** Applications over time, bucketed for the trend chart. */
  @ApiOkResponse({ type: TrendStatsDto })
  getTrend(@CurrentUser() user: { id: string }, @Query() query: StatsQueryDto) {
    return this.jobsStats.getTrend(user.id, query.range ?? 'all');
  }

  @Get('export')
  @ApiOperation({ summary: 'Export job applications as CSV' })
  @ApiOkResponse({
    description: 'CSV file download',
    content: { 'text/csv': {} },
  })
  /**
   * Downloads the filtered job list as CSV. Sets a response header when the
   * export hit its row cap, so the client can warn rather than hand over a
   * silently partial file.
   */
  async exportCsv(
    @CurrentUser() user: { id: string },
    @Query() query: JobQueryDto,
    @Res() res: Response,
  ) {
    const { csv, truncated } = await this.jobsStats.exportCsv(user.id, query);
    const suffix = query.status ? `-${query.status.toLowerCase()}` : '';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="jobs${suffix}.csv"`,
    );
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  @Get('attention')
  @ApiOperation({
    summary:
      'Jobs needing action: upcoming interviews and stalled applications',
  })
  /**
   * The "Needs Attention" list: upcoming interviews and stalled
   * applications.
   */
  @ApiOkResponse({ type: AttentionItemDto, isArray: true })
  getAttention(@CurrentUser() user: { id: string }) {
    return this.jobsStats.getAttention(user.id);
  }

  @Get('ghost-suggestions')
  @ApiOperation({
    summary:
      'Applications with no activity for 14 days that may be ghosted (suggest-only)',
  })
  /**
   * Applications quiet long enough to look ghosted. Suggest-only — nothing
   * here changes a status.
   */
  @ApiOkResponse({ type: GhostSuggestionDto, isArray: true })
  getGhostSuggestions(@CurrentUser() user: { id: string }) {
    return this.jobsStats.getGhostSuggestions(user.id);
  }

  @Post('ghost-suggestions/mark-ghosted')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Mark the listed jobs GHOSTED, skipping any that are no longer ghost suggestions',
  })
  /**
   * Marks the listed jobs ghosted, skipping any that no longer qualify.
   * Throttled as a bulk write — up to `MAX_GHOST_SUGGESTIONS` status
   * changes per call — the same cap as `POST /companies/import`.
   */
  @ApiOkResponse({ type: MarkGhostedResultDto })
  markGhosted(
    @CurrentUser() user: { id: string },
    @Body() dto: MarkGhostedDto,
  ) {
    return this.jobsService.markGhosted(user.id, dto.jobIds);
  }

  /** Returns one job with its company, resume, rounds and contacts. */
  @Get(':id')
  @ApiOperation({ summary: 'Get a single job application' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: JobResponseDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.jobsService.findOne(user.id, id);
  }

  /** Returns a page of the job's timeline events, newest first. */
  @Get(':id/events')
  @ApiOperation({ summary: 'Get timeline events for a job' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: PaginatedJobEventsDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  getEvents(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query() query: JobEventsQueryDto,
  ) {
    return this.jobsService.getEvents(user.id, id, query.page, query.limit);
  }

  @Post(':id/ghost-suggestion/dismiss')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Dismiss the ghost suggestion for a job until 14 more days pass with no activity',
  })
  /**
   * Dismisses the ghost suggestion for a job, quieting it until it goes
   * quiet again for another full cutoff period.
   */
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  dismissGhostSuggestion(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
  ) {
    return this.jobsService.dismissGhostSuggestion(user.id, id);
  }

  /**
   * Edits a job. A status change here is what writes a STATUS_CHANGE
   * timeline event.
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update a job application' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: JobResponseDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobsService.update(user.id, id, dto);
  }

  /** Deletes a job and everything that cascades from it. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a job application' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.jobsService.remove(user.id, id);
  }
}
