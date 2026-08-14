import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { BusinessMode, CompanyCity, JobPriority } from '@prisma/client';

// Enrichment-managed fields (status, errorMessage, enrichedAt, low-confidence
// flags) are deliberately absent here — those are only ever written by
// CompanyEnrichmentProcessor, same as Job.nextInterviewAt is absent from
// CreateJobDto/UpdateJobDto.
export class CreateCompanyDto {
  @ApiProperty({ example: 'Systems Limited', maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty({ enum: CompanyCity })
  @IsEnum(CompanyCity)
  city: CompanyCity;

  @ApiPropertyOptional({ example: 'DHA Phase 5, Lahore', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @ApiPropertyOptional({ enum: JobPriority })
  @IsOptional()
  @IsEnum(JobPriority)
  priority?: JobPriority;

  @ApiPropertyOptional({
    example: 'Great engineering culture, met their CTO at a meetup',
    maxLength: 5000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  personalNotes?: string | null;

  @ApiPropertyOptional({ example: 'https://systemsltd.com', maxLength: 500 })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  websiteUrl?: string | null;

  @ApiPropertyOptional({
    example: 'https://www.linkedin.com/company/systems-limited',
    maxLength: 500,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  linkedinUrl?: string | null;

  @ApiPropertyOptional({ enum: BusinessMode })
  @IsOptional()
  @IsEnum(BusinessMode)
  businessMode?: BusinessMode | null;

  @ApiPropertyOptional({
    example: 'IT staff augmentation for US clients',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  productDescription?: string | null;

  @ApiPropertyOptional({ example: 'Software Development', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  industry?: string | null;

  @ApiPropertyOptional({ example: '50-200 employees', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  companySize?: string | null;

  @ApiPropertyOptional({ example: ['React', 'Node.js', 'AWS'], type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  techStack?: string[];

  @ApiPropertyOptional({
    example: 'Collaborative and fast-paced culture',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  cultureSummary?: string | null;

  @ApiPropertyOptional({ example: 'Hybrid', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  workPolicy?: string | null;

  @ApiPropertyOptional({ example: '4/5', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  workLifeBalance?: string | null;

  @ApiPropertyOptional({ example: 'Lahore, Pakistan', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headquarters?: string | null;

  @ApiPropertyOptional({
    example: '123 Tech Park, DHA Phase 5, Lahore',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @ApiPropertyOptional({ example: '2005', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  founded?: string | null;
}
