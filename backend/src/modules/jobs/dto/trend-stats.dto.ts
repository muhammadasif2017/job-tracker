import { ApiProperty } from '@nestjs/swagger';

export class TrendBucketDto {
  @ApiProperty({ example: 'Jul 24' })
  label: string;

  @ApiProperty({ example: '2026-07-24T00:00:00.000Z' })
  periodStart: string;

  @ApiProperty({ example: 3, description: 'New applications in this period' })
  count: number;

  @ApiProperty({ example: 12, description: 'Running total up to this period' })
  cumulative: number;
}

export class TrendStatsDto {
  @ApiProperty({ enum: ['day', 'week', 'month'], example: 'week' })
  granularity: 'day' | 'week' | 'month';

  @ApiProperty({ type: () => TrendBucketDto, isArray: true })
  buckets: TrendBucketDto[];
}
