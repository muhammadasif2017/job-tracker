import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { JobStatus } from '@prisma/client';

export class CreateJobDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  company: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  position: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;

  @IsOptional()
  @IsDateString()
  appliedAt?: string;

  @IsOptional()
  @IsDateString()
  nextInterviewAt?: string;
}
