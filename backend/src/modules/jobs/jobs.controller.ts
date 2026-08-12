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
import { JobEventDto } from './dto/job-event.dto.js';
import { JobEventsQueryDto } from './dto/job-events-query.dto.js';
import { JobStatsDto } from './dto/job-stats.dto.js';
import { FunnelStatsDto } from './dto/funnel-stats.dto.js';
import { TrendStatsDto } from './dto/trend-stats.dto.js';
import { StatsQueryDto } from './dto/stats-query.dto.js';
import { AttentionItemDto } from './dto/attention-item.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { PatAccessible } from '../../common/decorators/pat-accessible.decorator.js';

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

  @Post()
  @PatAccessible()
  @ApiOperation({ summary: 'Create a job application' })
  @ApiCreatedResponse({ type: JobResponseDto })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user.id, dto);
  }

  @Post('parse')
  @PatAccessible()
  // Each call does a webFetch + Tavily search + Groq LLM round trip — real
  // external cost, and (combined with the SSRF hardening in WebFetchService)
  // a request path that shouldn't be hammerable at the global 100/60s rate.
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({
    summary:
      'Extract job fields from a posting URL or pasted text, for quick-add prefill',
  })
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
  @ApiOkResponse({ type: PaginatedJobsDto })
  findAll(@CurrentUser() user: { id: string }, @Query() query: JobQueryDto) {
    return this.jobsService.findAll(user.id, query);
  }

  // 'stats', 'stats/funnel', 'stats/trend', 'export', and 'attention' must
  // remain above ':id' — fixed segments take priority over parameterized
  // ones only when registered first in the same router.
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
  @ApiOkResponse({ type: AttentionItemDto, isArray: true })
  getAttention(@CurrentUser() user: { id: string }) {
    return this.jobsStats.getAttention(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single job application' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: JobResponseDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.jobsService.findOne(user.id, id);
  }

  @Get(':id/events')
  @ApiOperation({ summary: 'Get timeline events for a job' })
  @ApiParam({ name: 'id', description: 'Job ID' })
  @ApiOkResponse({ type: JobEventDto, isArray: true })
  getEvents(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query() query: JobEventsQueryDto,
  ) {
    return this.jobsService.getEvents(user.id, id, query.page, query.limit);
  }

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
