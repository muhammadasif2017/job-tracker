import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BusinessMode,
  CompanyCity,
  EnrichmentStatus,
  JobPriority,
} from '@prisma/client';

export class CompanyResponseDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ example: 'Systems Limited' })
  name: string;

  @ApiProperty({ enum: CompanyCity })
  city: CompanyCity;

  @ApiPropertyOptional({ example: 'DHA Phase 5, Lahore' })
  location: string | null;

  @ApiProperty({ enum: JobPriority })
  priority: JobPriority;

  @ApiPropertyOptional()
  personalNotes: string | null;

  @ApiPropertyOptional({ example: 'https://systemsltd.com' })
  websiteUrl: string | null;

  @ApiPropertyOptional({
    example: 'https://www.linkedin.com/company/systems-limited',
  })
  linkedinUrl: string | null;

  @ApiPropertyOptional({ enum: BusinessMode })
  businessMode: BusinessMode | null;

  @ApiPropertyOptional({ example: 'IT staff augmentation for US clients' })
  productDescription: string | null;

  @ApiPropertyOptional({
    enum: EnrichmentStatus,
    description: 'null means enrichment has never been triggered',
  })
  status: EnrichmentStatus | null;

  @ApiPropertyOptional({ example: 'Software Development' })
  industry: string | null;

  @ApiPropertyOptional({ example: '50-200 employees' })
  companySize: string | null;

  @ApiProperty({
    example: ['React', 'Node.js', 'AWS'],
    type: String,
    isArray: true,
  })
  techStack: string[];

  @ApiPropertyOptional({ example: 'Collaborative and fast-paced culture' })
  cultureSummary: string | null;

  @ApiPropertyOptional({ example: 'Hybrid' })
  workPolicy: string | null;

  @ApiPropertyOptional({ example: '4/5' })
  workLifeBalance: string | null;

  @ApiPropertyOptional({ example: 'Lahore, Pakistan' })
  headquarters: string | null;

  @ApiPropertyOptional()
  headquartersLowConfidence: boolean;

  @ApiPropertyOptional({ example: '123 Tech Park, DHA Phase 5, Lahore' })
  address: string | null;

  @ApiPropertyOptional()
  addressLowConfidence: boolean;

  @ApiPropertyOptional({ example: '2005' })
  founded: string | null;

  @ApiPropertyOptional()
  errorMessage: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  enrichedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}
