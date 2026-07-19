import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateInterviewRoundDto {
  @ApiProperty({ example: 'Phone Screen', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stage: string;

  @ApiProperty({ example: '2024-03-22', format: 'date' })
  @IsDateString()
  scheduledAt: string;

  @ApiPropertyOptional({ example: 'Ask about on-call rotation', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
