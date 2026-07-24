import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { STATS_RANGES, type StatsRange } from '../jobs.constants.js';

export class StatsQueryDto {
  @ApiPropertyOptional({ enum: STATS_RANGES, default: 'all' })
  @IsOptional()
  @IsIn(STATS_RANGES)
  range?: StatsRange = 'all';
}
