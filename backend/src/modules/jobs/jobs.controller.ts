import {
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
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiNotFoundResponse,
  ApiUnauthorizedResponse,
  ApiHeader,
  ApiConflictResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { JobResponseDto } from './dto/job-response.dto.js';
import { PaginatedJobsDto } from './dto/paginated-jobs.dto.js';
import { PaginatedJobEventsDto } from './dto/paginated-job-events.dto.js';
import { JobEventsQueryDto } from './dto/job-events-query.dto.js';
import {
  MarkGhostedDto,
  MarkGhostedResultDto,
} from './dto/mark-ghosted.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { PatAccessible } from '../../common/decorators/pat-accessible.decorator.js';
import { IdempotencyInterceptor } from '../../common/interceptors/idempotency.interceptor.js';

/**
 * A user's job applications: the list and detail views, create, update and
 * delete, the job event history, and the two ghost-suggestion write actions.
 * The read-only aggregates — stats, funnel, trend, CSV export, the
 * needs-attention list and the ghost suggestions themselves — live in
 * `JobsStatsModule`, and Quick Add's posting parser in `JobParsingModule`,
 * both mounted under this same prefix.
 *
 * Every literal route — here `ghost-suggestions/mark-ghosted`, and every
 * route on `JobsStatsController` — must stay above `:id`. A fixed segment
 * only wins over a parameterized one when it is registered first, which is
 * also why `JobsStatsModule` is registered before `JobsModule`.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class JobsController {
  constructor(private jobsService: JobsService) {}

  /**
   * Creates a job application. Safe to retry with the same
   * `Idempotency-Key`: see `IdempotencyInterceptor`.
   */
  @Post()
  @PatAccessible()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create a job application' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-generated key (1-255 chars). A retry with the same key and body returns the first response with `Idempotent-Replayed: true` instead of creating a duplicate. Remembered for 24 hours.',
  })
  @ApiCreatedResponse({ type: JobResponseDto })
  @ApiConflictResponse({
    description: 'A request with this Idempotency-Key is still in progress',
  })
  @ApiUnprocessableEntityResponse({
    description: 'Idempotency-Key was already used with a different body',
  })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user.id, dto);
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
