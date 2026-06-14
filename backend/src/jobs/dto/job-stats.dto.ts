import { ApiProperty } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';

export class ByStatusDto {
  @ApiProperty({ example: 3 }) [JobStatus.WISHLIST]: number;
  @ApiProperty({ example: 12 }) [JobStatus.APPLIED]: number;
  @ApiProperty({ example: 5 }) [JobStatus.INTERVIEWING]: number;
  @ApiProperty({ example: 1 }) [JobStatus.OFFER]: number;
  @ApiProperty({ example: 8 }) [JobStatus.REJECTED]: number;
  @ApiProperty({ example: 2 }) [JobStatus.GHOSTED]: number;
}

export class JobStatsDto {
  @ApiProperty({ example: 31 })
  total: number;

  @ApiProperty({ type: () => ByStatusDto })
  byStatus: ByStatusDto;

  @ApiProperty({ example: 7, description: 'Applications this calendar month' })
  thisMonth: number;

  @ApiProperty({
    example: 45.2,
    description: 'Percentage of apps that got a response',
  })
  responseRate: number;
}
