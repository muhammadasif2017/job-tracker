import { ApiPropertyOptional } from '@nestjs/swagger';
import { DigestFrequency } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';
import { IsIanaTimezone } from '../../../common/validators/is-iana-timezone.validator.js';

export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  interviewRemindersEnabled?: boolean;

  @ApiPropertyOptional({ enum: DigestFrequency, example: DigestFrequency.OFF })
  @IsOptional()
  @IsEnum(DigestFrequency)
  digestFrequency?: DigestFrequency;

  @ApiPropertyOptional({ example: 'Asia/Karachi' })
  @IsOptional()
  @IsString()
  @IsIanaTimezone()
  timezone?: string;
}
