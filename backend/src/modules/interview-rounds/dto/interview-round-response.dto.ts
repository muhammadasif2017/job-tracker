import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InterviewOutcome } from '@prisma/client';
import {
  INTERVIEW_ROUND_DERIVED_STATUSES,
  type InterviewRoundDerivedStatus,
} from '../interview-round-status.util.js';

export class InterviewRoundResponseDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ format: 'cuid' })
  jobId: string;

  @ApiProperty({ example: 'Phone Screen' })
  stage: string;

  @ApiProperty({ format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ enum: InterviewOutcome })
  outcome: InterviewOutcome;

  // Computed, not stored — splits PENDING into SCHEDULED/AWAITING_RESPONSE/
  // POSSIBLY_GHOSTED based on scheduledAt vs now (see interview-round-status.util.ts).
  @ApiProperty({ enum: INTERVIEW_ROUND_DERIVED_STATUSES })
  derivedStatus: InterviewRoundDerivedStatus;

  @ApiPropertyOptional({ example: 'Ask about on-call rotation' })
  notes: string | null;

  @ApiPropertyOptional({
    example: '- Review React hooks\n- Ask about on-call rotation',
    description:
      'LLM-generated talking points for this round, produced from the ' +
      'debrief notes on the previously-completed round for the same job.',
  })
  prepSuggestions: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  prepGeneratedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}
