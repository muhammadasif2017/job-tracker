import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';

const TWO_YEARS_MS = 2 * 365 * 24 * 60 * 60 * 1000;

// scheduledAt is user-entered and otherwise unbounded — a typo'd year (e.g.
// 2062 instead of 2026) would silently pass IsDateString and then corrupt
// nextInterviewAt / the "needs attention" heuristics. Interview scheduling
// realistically never happens more than ~2 years out in either direction.
function IsPlausibleDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isPlausibleDate',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const time = Date.parse(value);
          if (Number.isNaN(time)) return true; // let @IsDateString own format errors
          const now = Date.now();
          return time >= now - TWO_YEARS_MS && time <= now + TWO_YEARS_MS;
        },
        defaultMessage() {
          return 'scheduledAt must be within 2 years of today';
        },
      },
    });
  };
}

export class CreateInterviewRoundDto {
  @ApiProperty({ example: 'Phone Screen', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  stage: string;

  @ApiProperty({ example: '2024-03-22', format: 'date' })
  @IsDateString()
  @IsPlausibleDate()
  scheduledAt: string;

  @ApiPropertyOptional({ example: 'Ask about on-call rotation', maxLength: 5000 })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}
