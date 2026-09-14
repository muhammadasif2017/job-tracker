import { ApiProperty } from '@nestjs/swagger';
import { JobResponseDto } from './job-response.dto.js';

export class GhostSuggestionDto {
  @ApiProperty({
    description:
      'Last activity: latest event, last dismissal, or applied date, whichever is newest',
  })
  since: Date;

  @ApiProperty({ type: () => JobResponseDto })
  job: JobResponseDto;
}
