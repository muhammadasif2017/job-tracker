import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InterviewOutcome } from '@prisma/client';

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

  @ApiPropertyOptional({ example: 'Ask about on-call rotation' })
  notes: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}
