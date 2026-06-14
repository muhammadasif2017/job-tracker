import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JobEventType, JobStatus } from '@prisma/client';

export class JobEventDto {
  @ApiProperty({ format: 'cuid' })
  id: string;

  @ApiProperty({ format: 'cuid' })
  jobId: string;

  @ApiProperty({ enum: JobEventType })
  type: JobEventType;

  @ApiPropertyOptional({ enum: JobStatus })
  fromStatus: JobStatus | null;

  @ApiProperty({ enum: JobStatus })
  toStatus: JobStatus;

  @ApiPropertyOptional()
  note: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt: Date;
}
