import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';
import { InterviewOutcome } from '@prisma/client';
import { CreateInterviewRoundDto } from './create-interview-round.dto.js';

export class UpdateInterviewRoundDto extends PartialType(
  CreateInterviewRoundDto,
) {
  @ApiPropertyOptional({ enum: InterviewOutcome })
  @IsOptional()
  @IsEnum(InterviewOutcome)
  outcome?: InterviewOutcome;
}
