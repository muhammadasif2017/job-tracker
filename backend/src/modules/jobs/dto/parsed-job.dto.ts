import { ApiPropertyOptional } from '@nestjs/swagger';
import { JobType, ApplicationChannel } from '@prisma/client';

export class ParsedJobDto {
  @ApiPropertyOptional({ example: 'Acme Corp' })
  company?: string | null;

  @ApiPropertyOptional({ example: 'Senior Engineer' })
  position?: string | null;

  @ApiPropertyOptional({ example: 'Remote' })
  location?: string | null;

  @ApiPropertyOptional({ example: 'https://jobs.example.com/123' })
  url?: string;

  @ApiPropertyOptional({ enum: JobType })
  jobType?: JobType;

  @ApiPropertyOptional({ enum: ApplicationChannel })
  applicationChannel?: ApplicationChannel;
}
