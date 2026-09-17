import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { InterviewOutcome } from '@prisma/client';
import { CreateInterviewRoundDto } from './create-interview-round.dto.js';

/** Body for editing an interview round, including recording its outcome. */
export class UpdateInterviewRoundDto extends PartialType(
  CreateInterviewRoundDto,
) {
  @ApiPropertyOptional({ enum: InterviewOutcome })
  @IsOptional()
  @IsEnum(InterviewOutcome)
  outcome?: InterviewOutcome;
}
