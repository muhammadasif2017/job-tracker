import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JobsStatsService } from './jobs-stats.service.js';
import { JobStatsDto } from './dto/job-stats.dto.js';
import { FunnelStatsDto } from './dto/funnel-stats.dto.js';
import { TrendStatsDto } from './dto/trend-stats.dto.js';
import { StatsQueryDto } from './dto/stats-query.dto.js';
import { GhostSuggestionDto } from './dto/ghost-suggestion.dto.js';
import { JobQueryDto } from '../jobs/dto/job-query.dto.js';
import { AttentionItemDto } from '../jobs/dto/attention-item.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';

/**
 * Read-only aggregates over a user's jobs, mounted under the `jobs` prefix
 * alongside `JobsController`.
 *
 * **`JobsStatsModule` must be registered before `JobsModule` in
 * `AppModule`.** Every route here is a fixed segment under `jobs`, and
 * `JobsController` declares `@Get(':id')`. A fixed segment only wins over a
 * parameterized one when it is registered first, so a later registration
 * routes `GET /jobs/stats` into `findOne` with an id of `"stats"` and every
 * one of these returns 404. `test/app.e2e-spec.ts` asserts real body shapes
 * on `/jobs/stats`, `/jobs/stats/funnel`, `/jobs/attention`,
 * `/jobs/ghost-suggestions` and `/jobs/export`, so a wrong order fails CI
 * rather than reaching production.
 */
@ApiTags('jobs')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Missing or invalid access token' })
@Controller('jobs')
export class JobsStatsController {
  constructor(private jobsStats: JobsStatsService) {}

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
}
