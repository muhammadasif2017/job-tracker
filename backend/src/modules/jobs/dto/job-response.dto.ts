import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobStatus, JobPriority, JobType, JobSource } from '@prisma/client';
import { CompanyProfileResponseDto } from './company-profile-response.dto.js';
import { ResumeResponseDto } from '../../resumes/dto/resume-response.dto.js';
import { InterviewRoundResponseDto } from '../../interview-rounds/dto/interview-round-response.dto.js';

export class JobResponseDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'Acme Corp' })
  company: string;

  @ApiProperty({ example: 'Senior Engineer' })
  position: string;

  @ApiPropertyOptional({ example: 'Remote' })
  location: string | null;

  @ApiPropertyOptional({ example: 'https://jobs.example.com/123' })
  url: string | null;

  @ApiProperty({ enum: JobStatus })
  status: JobStatus;

  @ApiProperty({ enum: JobPriority })
  priority: JobPriority;

  @ApiProperty({ enum: JobType })
  jobType: JobType;

  @ApiPropertyOptional({ enum: JobSource })
  source: JobSource | null;

  @ApiPropertyOptional({ example: 'Referral from John' })
  notes: string | null;

  @ApiProperty({ format: 'date-time' })
  appliedAt: Date;

  @ApiPropertyOptional({ format: 'date-time' })
  nextInterviewAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ format: 'cuid' })
  userId: string;

  @ApiPropertyOptional({ type: () => CompanyProfileResponseDto })
  companyProfile: CompanyProfileResponseDto | null;

  @ApiPropertyOptional({ type: () => ResumeResponseDto })
  resume: ResumeResponseDto | null;

  @ApiPropertyOptional({ type: () => InterviewRoundResponseDto, isArray: true })
  interviewRounds?: InterviewRoundResponseDto[];
}
