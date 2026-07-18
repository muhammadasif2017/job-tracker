import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { JobResponseDto } from './dto/job-response.dto.js';
import { PaginatedJobsDto } from './dto/paginated-jobs.dto.js';
import { JobEventDto } from './dto/job-event.dto.js';
import { JobStatsDto } from './dto/job-stats.dto.js';
import { AttentionItemDto } from './dto/attention-item.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a job application' })
  @ApiCreatedResponse({ type: JobResponseDto })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List job applications with filters and pagination',
  })
  @ApiOkResponse({ type: PaginatedJobsDto })
  findAll(@CurrentUser() user: { id: string }, @Query() query: JobQueryDto) {
    return this.jobsService.findAll(user.id, query);
  }

  // 'stats', 'export', and 'attention' must remain above ':id' — fixed segments
  // take priority over parameterized ones only when registered first in the
  // same router.
  @Get('stats')
  @ApiOperation({ summary: 'Get application funnel stats' })
  @ApiOkResponse({ type: JobStatsDto })
  getStats(@CurrentUser() user: { id: string }) {
    return this.jobsService.getStats(user.id);
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
    const { csv, truncated } = await this.jobsService.exportCsv(user.id, query);
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
    return this.jobsService.getAttention(user.id);
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
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOkResponse({ type: JobEventDto, isArray: true })
  getEvents(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.jobsService.getEvents(user.id, id, page, limit);
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
