import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ContactResponseDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiPropertyOptional({
    format: 'cuid',
    description:
      'Set when this contact belongs to a job, null for a company contact',
  })
  jobId: string | null;

  @ApiPropertyOptional({
    format: 'cuid',
    description:
      'Set when this contact belongs to a company, null for a job contact',
  })
  companyId: string | null;

  @ApiProperty({ example: 'Jane Doe' })
  name: string;

  @ApiPropertyOptional({ example: 'Recruiter' })
  role: string | null;

  @ApiPropertyOptional({ example: 'jane.doe@example.com' })
  email: string | null;

  @ApiPropertyOptional({ example: '+1 555 123 4567' })
  phone: string | null;

  @ApiPropertyOptional({ example: 'https://www.linkedin.com/in/janedoe' })
  linkedinUrl: string | null;

  @ApiPropertyOptional({
    example: 'Met at the referral call, mentioned team is hiring fast',
  })
  notes: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt: Date;
}
