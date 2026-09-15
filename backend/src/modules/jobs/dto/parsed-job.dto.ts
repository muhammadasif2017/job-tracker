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

  // Set only when extraction failed because the LLM call itself errored (not
  // because the content had no job details), so a client can offer a retry.
  // Still a 200 with a partial result: the browser extension falls back to
  // manual entry on it, which a 5xx would block.
  @ApiPropertyOptional({
    example: true,
    description: 'The job parser could not be reached; retrying may succeed',
  })
  parserUnavailable?: true;
}
