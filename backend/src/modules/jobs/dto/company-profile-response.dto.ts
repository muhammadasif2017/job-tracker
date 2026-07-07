import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EnrichmentStatus } from '@prisma/client';

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

  @ApiPropertyOptional({ example: 'Hybrid' })
  remotePolicy: string | null;

  @ApiPropertyOptional({ example: '4/5' })
  workLifeBalance: string | null;

  @ApiPropertyOptional({ example: 'San Francisco, CA' })
  headquarters: string | null;

  @ApiPropertyOptional({
    example: '1600 Amphitheatre Parkway, Mountain View, CA 94043',
  })
  address: string | null;

  @ApiPropertyOptional({ example: '2010' })
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
