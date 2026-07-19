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
} from '@nestjs/common';
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
import { InterviewRoundsService } from './interview-rounds.service.js';
import { CreateInterviewRoundDto } from './dto/create-interview-round.dto.js';
import { UpdateInterviewRoundDto } from './dto/update-interview-round.dto.js';
import { InterviewRoundResponseDto } from './dto/interview-round-response.dto.js';
import { MessageDto } from '../../common/dto/message.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class InterviewRoundsController {
  constructor(private interviewRoundsService: InterviewRoundsService) {}

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

  @Get(':jobId/interview-rounds')
  @ApiOperation({ summary: 'List interview rounds for a job' })
  @ApiParam({ name: 'jobId', description: 'Job ID' })
  @ApiOkResponse({ type: InterviewRoundResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Job not found' })
  findAll(
    @CurrentUser() user: { id: string },
    @Param('jobId') jobId: string,
  ) {
    return this.interviewRoundsService.findAllForJob(user.id, jobId);
  }

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
