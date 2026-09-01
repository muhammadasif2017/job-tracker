import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  JobStatus,
  JobPriority,
  JobType,
  DiscoverySource,
  ApplicationChannel,
} from '@prisma/client';
import { CompanyProfileResponseDto } from './company-profile-response.dto.js';
import { ResumeResponseDto } from '../../resumes/dto/resume-response.dto.js';
import { InterviewRoundResponseDto } from '../../interview-rounds/dto/interview-round-response.dto.js';

// Only ever populated on the POST /jobs response — a case-insensitive
// name match against the user's target-company list (soft-link, no FK; see
// docs/specs/target-companies.md). Never persisted on Job itself.
export class MatchedCompanyDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'Systems Limited' })
  name: string;
}

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

  @ApiPropertyOptional({ enum: DiscoverySource })
  discoverySource: DiscoverySource | null;

  @ApiPropertyOptional({ enum: ApplicationChannel })
  applicationChannel: ApplicationChannel | null;

  @ApiPropertyOptional({ example: 'Referral from John' })
  notes: string | null;

  @ApiProperty({ format: 'date-time' })
  appliedAt: Date;

  @ApiPropertyOptional({ format: 'date-time' })
  nextInterviewAt: Date | null;

  @ApiPropertyOptional({
    example: 'Applied, then moved to interviewing.',
    description:
      "LLM-generated one-line summary of this job's event timeline, " +
      'regenerated asynchronously after each status change.',
  })
  timelineSummary: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  timelineSummaryAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;

  @ApiProperty({ format: 'cuid' })
  userId: string;

  @ApiPropertyOptional({ format: 'cuid' })
  companyId: string | null;

  // Only findOne's reshaped response actually populates this — PATCH /jobs/:id
  // returns the raw Prisma update result, which doesn't include companyLink.
  // Frontend mutations that consume the PATCH response account for this
  // (e.g. usePatchJobStatusMutation re-grafts the previous companyProfile
  // rather than trusting the response) — don't add a new PATCH consumer that
  // reads this field without checking findOne first.
  @ApiPropertyOptional({ type: () => CompanyProfileResponseDto })
  companyProfile: CompanyProfileResponseDto | null;

  @ApiPropertyOptional({ type: () => ResumeResponseDto })
  resume: ResumeResponseDto | null;

  @ApiPropertyOptional({ type: () => InterviewRoundResponseDto, isArray: true })
  interviewRounds?: InterviewRoundResponseDto[];

  @ApiPropertyOptional({
    type: () => MatchedCompanyDto,
    description:
      'Only present on the create response — a saved target company whose ' +
      "name case-insensitively matches this job's company field, or null " +
      'if none matched.',
  })
  matchedCompany?: MatchedCompanyDto | null;
}
