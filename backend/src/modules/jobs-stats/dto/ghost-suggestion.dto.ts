import { ApiProperty } from '@nestjs/swagger';
import { JobResponseDto } from '../../jobs/dto/job-response.dto.js';

/** One "Looks ghosted" suggestion: the job and the date it went silent. */
export class GhostSuggestionDto {
  @ApiProperty({
    description:
      'Last activity: latest event, last dismissal, or applied date, whichever is newest',
  })
  since: Date;

  @ApiProperty({ type: () => JobResponseDto })
  job: JobResponseDto;
}
