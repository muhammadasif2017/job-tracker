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
  Res,
} from '@nestjs/common';
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
  ApiProduces,
} from '@nestjs/swagger';
import { InterviewRoundsService } from './interview-rounds.service.js';
import { CreateInterviewRoundDto } from './dto/create-interview-round.dto.js';
import { UpdateInterviewRoundDto } from './dto/update-interview-round.dto.js';
import { InterviewRoundResponseDto } from './dto/interview-round-response.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

/**
 * Interview rounds always hang off a job, so every route here is nested
 * under /jobs/:jobId and the service derives ownership from that parent
 * (ADR-015).
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class InterviewRoundsController {
  constructor(private interviewRoundsService: InterviewRoundsService) {}

  /** Schedules a round on the job named in the route. */
  @Post(':jobId/interview-rounds')
  @ApiOperation({ summary: 'Add an interview round to a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiCreatedResponse({ type: InterviewRoundResponseDto })
  @ApiNotFoundResponse({ description: 'Job not found' })
  create(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Body() dto: CreateInterviewRoundDto,
  ) {
    return this.interviewRoundsService.create(user.id, jobId, dto);
  }

  /** Lists the job's rounds, earliest first. */
  @Get(':jobId/interview-rounds')
  @ApiOperation({ summary: 'List interview rounds for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ type: InterviewRoundResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Job not found' })
  findAll(@CurrentUser() user: { id: string }, @Param('jobId') jobId: string) {
    return this.interviewRoundsService.findAllForJob(user.id, jobId);
  }

  /** Edits a round: its stage, time, length, outcome or debrief notes. */
  @Patch(':jobId/interview-rounds/:roundId')
  @ApiOperation({ summary: 'Update an interview round' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiParam({ name: 'roundId', description: 'Interview round ID' })
  @ApiOkResponse({ type: InterviewRoundResponseDto })
  @ApiNotFoundResponse({ description: 'Job or interview round not found' })
  update(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Param('roundId') roundId: string,
    @Body() dto: UpdateInterviewRoundDto,
  ) {
    return this.interviewRoundsService.update(user.id, jobId, roundId, dto);
  }

  @Get(':jobId/interview-rounds/:roundId/ics')
  @ApiOperation({
    summary: 'Download an interview round as a calendar (.ics) file',
  })
  /**
   * Streams one round back as a downloadable .ics file. Uses @Res directly
   * because the response is a file body with its own Content-Type and
   * Content-Disposition, not the JSON every other route here returns.
   */
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiParam({ name: 'roundId', description: 'Interview round ID' })
  @ApiProduces('text/calendar')
  @ApiNotFoundResponse({ description: 'Job or interview round not found' })
  async exportIcs(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Param('roundId') roundId: string,
    @Res() res: Response,
  ) {
    const { filename, content } = await this.interviewRoundsService.exportIcs(
      user.id,
      jobId,
      roundId,
    );
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }

  /** Deletes a round. */
  @Delete(':jobId/interview-rounds/:roundId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an interview round' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiParam({ name: 'roundId', description: 'Interview round ID' })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({ description: 'Job or interview round not found' })
  remove(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
    @Param('roundId') roundId: string,
  ) {
    return this.interviewRoundsService.remove(user.id, jobId, roundId);
  }
}
