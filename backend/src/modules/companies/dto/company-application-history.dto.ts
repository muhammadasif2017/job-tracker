import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus } from '@prisma/client';
import { CompanyApplicationStatsDto } from './company-application-stats.dto.js';

export class CompanyRefDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'Systems Limited' })
  name: string;
}

export class RecentCompanyJobDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'Backend Engineer' })
  position: string;

  @ApiProperty({ enum: JobStatus })
  status: JobStatus;

  @ApiProperty({ format: 'date-time' })
  appliedAt: Date;
}

// Backs the "you applied here before" confirm on job create
// (docs/specs/company-reply-history.md).
export class CompanyApplicationHistoryDto {
  @ApiPropertyOptional({
    type: () => CompanyRefDto,
    description: 'null when no company has this name',
  })
  company: CompanyRefDto | null;

  @ApiPropertyOptional({ type: () => CompanyApplicationStatsDto })
  stats: CompanyApplicationStatsDto | null;

  @ApiProperty({
    type: () => RecentCompanyJobDto,
    isArray: true,
    description: 'Up to 3 jobs, newest appliedAt first, any status',
  })
  recentJobs: RecentCompanyJobDto[];
}
