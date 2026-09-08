import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessMode, EnrichmentStatus } from '@prisma/client';

export class CompanyProfileResponseDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ format: 'cuid' })
  jobId: string;

  // Nullable, and null is not a degenerate case: it means enrichment was
  // never triggered for this company (Company.status has no DB default),
  // which is distinct from an in-flight PENDING run. Consumers must handle
  // it rather than assuming a value — see the comment in JobsService.findOne.
  @ApiPropertyOptional({ enum: EnrichmentStatus, nullable: true })
  status: EnrichmentStatus | null;

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
