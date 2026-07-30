import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobType, JobSource } from '@prisma/client';

export class ParsedJobDto {
  @ApiPropertyOptional({ example: 'Acme Corp' })
  company?: string;

  @ApiPropertyOptional({ example: 'Senior Engineer' })
  position?: string;

  @ApiPropertyOptional({ example: 'Remote' })
  location?: string;

  @ApiPropertyOptional({ example: 'https://jobs.example.com/123' })
  url?: string;

  @ApiPropertyOptional({ enum: JobType })
  jobType?: JobType;

  @ApiPropertyOptional({ enum: JobSource })
  source?: JobSource;
}
