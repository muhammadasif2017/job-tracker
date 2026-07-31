import { ApiPropertyOptional } from '@nestjs/swagger';
import { DigestFrequency } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class UpdateNotificationPrefsDto {
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  interviewRemindersEnabled?: boolean;

  @ApiPropertyOptional({ enum: DigestFrequency, example: DigestFrequency.OFF })
  @IsOptional()
  @IsEnum(DigestFrequency)
  digestFrequency?: DigestFrequency;
}
