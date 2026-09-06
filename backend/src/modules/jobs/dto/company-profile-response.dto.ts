import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessMode, EnrichmentStatus } from '@prisma/client';

export class CompanyProfileResponseDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ format: 'cuid' })
  jobId: string;

  @ApiProperty({ enum: EnrichmentStatus })
  status: EnrichmentStatus;

  @ApiPropertyOptional({ example: 'Software' })
  industry: string | null;

  @ApiPropertyOptional({ example: '1000-5000' })
  companySize: string | null;

  @ApiProperty({
    example: ['TypeScript', 'React'],
    type: String,
    isArray: true,
  })
  techStack: string[];

  @ApiPropertyOptional({ example: 'Collaborative and fast-paced culture' })
  cultureSummary: string | null;

  @ApiPropertyOptional({
    example: 'Builds payments infrastructure for online businesses.',
  })
  productDescription: string | null;

  @ApiPropertyOptional({ enum: BusinessMode, example: BusinessMode.PRODUCT })
  businessMode: BusinessMode | null;

  @ApiPropertyOptional()
  errorMessage: string | null;

  @ApiPropertyOptional({ format: 'date-time' })
  enrichedAt: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}
