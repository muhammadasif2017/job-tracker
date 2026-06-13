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
import { JobsService } from './jobs.service.js';
import { CreateJobDto } from './dto/create-job.dto.js';
import { UpdateJobDto } from './dto/update-job.dto.js';
import { JobQueryDto } from './dto/job-query.dto.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';

@Controller('jobs')
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Post()
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateJobDto) {
    return this.jobsService.create(user.id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { id: string }, @Query() query: JobQueryDto) {
    return this.jobsService.findAll(user.id, query);
  }

  // 'stats' and 'export' must remain above ':id' — fixed segments take priority
  // over parameterized ones only when registered first in the same router.
  @Get('stats')
  getStats(@CurrentUser() user: { id: string }) {
    return this.jobsService.getStats(user.id);
  }

  @Get('export')
  async exportCsv(
    @CurrentUser() user: { id: string },
    @Query() query: JobQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.jobsService.exportCsv(user.id, query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="jobs.csv"');
    res.send(csv);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.jobsService.findOne(user.id, id);
  }

  @Get(':id/events')
  getEvents(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.jobsService.getEvents(user.id, id, page, limit);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: { id: string },
    @Param('id') id: string,
    @Body() dto: UpdateJobDto,
  ) {
    return this.jobsService.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.jobsService.remove(user.id, id);
  }
}
