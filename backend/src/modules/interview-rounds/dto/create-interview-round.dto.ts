import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IsPlausibleDate } from '../../../common/validators/is-plausible-date.validator.js';
import { HasUtcOffset } from '../../../common/validators/has-utc-offset.validator.js';

export class CreateInterviewRoundDto {
  @ApiProperty({ example: 'Phone Screen', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stage: string;

  // A real instant, not a civil date (ADR-034, ADR-043) — an interview happens
  // at a time, reminder emails schedule off it, and the attention list filters
  // it on a 48-hour window. The client must send an explicit UTC offset:
  // `new Date('2026-03-22T14:00')` (no offset) parses as *server* local time
  // while a bare date parses as UTC, so an offset-less value silently means
  // different instants on a UTC dev box and a non-UTC host.
  @ApiProperty({ example: '2024-03-22T14:00:00.000Z', format: 'date-time' })
  @IsDateString()
  @HasUtcOffset()
  @IsPlausibleDate()
  scheduledAt: string;

  // Required here, nullable in the column: rounds written before ADR-043 have
  // no length and are left alone rather than backfilled with a guess.
  @ApiProperty({ example: 60, minimum: 5, maximum: 1440 })
  @IsInt()
  @Min(5)
  @Max(1440)
  durationMinutes: number;

  @ApiPropertyOptional({
    example: 'Ask about on-call rotation',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
